# WealthPilot API

FastAPI modular monolith plus a Postgres-backed job queue. Production runs on **Vercel** (Python functions, Neon
Postgres from the Vercel Marketplace, inline jobs + Vercel Cron); see [Deploying to Vercel](#deploying-to-vercel).
The Dockerfile and the standalone worker remain for container hosts. Implements [`docs/api-contract.md`](../../docs/api-contract.md);
the generated OpenAPI document is served at `/v1/openapi.json` and committed at
[`packages/contracts/openapi.json`](../../packages/contracts/openapi.json). All money math lives in
[`wealthpilot_calc`](../../packages/calculation_engine) (Decimal only); the API stores, scopes and serves it.

## Quick start

```bash
scripts/dev-db.sh up && scripts/dev-db.sh migrate      # from the repo root: Postgres on 127.0.0.1:55432
cd services/api
cp .env.example .env                                   # dev auth + inline jobs
uv sync
uv run uvicorn wealthpilot_api.main:app --reload       # http://127.0.0.1:8000/v1/docs
uv run python -m wealthpilot_api.worker                # only needed with WP_INLINE_JOBS=0
uv run python scripts/seed_dev.py                      # SYNTHETIC spec §16 household for dev user "demo"
curl -H "Authorization: Bearer dev:demo:demo@example.test" http://127.0.0.1:8000/v1/net-worth
```

## Tests and checks

```bash
uv run pytest                                   # needs Postgres; WP_TEST_ADMIN_URL overrides the admin URL
uv run ruff check src tests scripts && uv run ruff format --check src tests scripts
uv run python scripts/export_openapi.py         # regenerate packages/contracts/openapi.json (--check in CI)
```

Each test session creates a throwaway database, migrates it with Alembic, truncates all tables between tests and
drops it at the end. Outbound HTTP (frankfurter, JWKS, Expo) is mocked.

## Layout

```
src/wealthpilot_api/
  main.py            app factory (CORS, request IDs, idempotency, RFC 7807 errors, routers under /v1)
  worker.py          python -m wealthpilot_api.worker [--once] (container hosts)
  core/              settings, DB, errors, request context, idempotency middleware, shared schema types
  modules/
    auth/            OIDC JWT verification (JWKS, cached), dev tokens, user provisioning, household scope
    households/      /me, onboarding, tax residency, security events, households
    accounts/        accounts, append-only valuations, net worth, history, insights
    market_data/     user FX rates, frankfurter reference rates, manual prices
    equity/          RSU grants, vests, dispositions, calendar
    jobs/            queue, scheduler (daily jobs + sweep), internal cron endpoints, maintenance
    goals/  scenarios/  reports/  notifications/  billing/  privacy/  compliance/  health/
alembic/             migrations (0001 = full initial schema, triggers for immutable rows; 0002 = export_artifacts)
index.py             Vercel entrypoint (top-level `app`)
vercel.json          Vercel function settings and cron schedules
scripts/vercel_build.py  Vercel build step: validate settings, check imports, alembic upgrade head
```

## Behaviour notes

- **Auth.** `Authorization: Bearer <JWT>` verified against `WP_OIDC_JWKS_URL` (asymmetric algorithms only; `iss`,
  `exp`, `iat`, `sub` required; `aud` when `WP_OIDC_AUDIENCE` is set; `azp` must be in
  `WP_OIDC_AUTHORIZED_PARTIES` when that is set and the claim is present). The first call provisions the user.
  `WP_AUTH_MODE=dev` additionally accepts `Bearer dev:<subject>:<email>` and is refused when `WP_ENV=production`
  and on every Vercel production or preview deployment.
- **Tenancy.** Every query is scoped to the caller's household; other households' resources return 404.
- **Concurrency.** Mutable rows carry `version`; a stale `version` in a PATCH returns 409 `VERSION_CONFLICT`.
  `Idempotency-Key` on POSTs is scoped per user; a replay returns the stored response with
  `Idempotent-Replayed: true`, the same key with a different body returns 422 `IDEMPOTENCY_KEY_REUSED`.
- **Immutability.** Valuations are append-only (corrections supersede) and scenario versions are immutable, both
  enforced by Postgres triggers. Runs store their full result; results and exports never recompute.
- **Jobs.** `jobs` table claimed with `FOR UPDATE SKIP LOCKED`; failures retry with exponential backoff
  (2^attempt s, max 1 h) up to `WP_JOB_MAX_ATTEMPTS`, then are dead-lettered (`failed`) and the run/export is
  marked failed. `daily_notifications` and `daily_maintenance` are enqueued once per UTC day (de-duplicated by
  date) by the worker, or by `GET /v1/internal/cron/daily` on hosts without one. `/v1/internal/cron/sweep`
  requeues jobs stuck in `running` for 15 minutes and runs every due job (retries, scheduled erasures). Both cron
  endpoints require `Authorization: Bearer $CRON_SECRET`, are idempotent and are not in the OpenAPI document.
- **Exports.** CSV/JSON for balances and assumptions, CSV/JSON/PDF for a run. Download links are HMAC-signed and
  valid 15 minutes (`GET /v1/exports/{id}/download?token=`); free-plan PDFs are watermarked. Artifacts are
  stored on local disk, in S3 (SSE) or in Postgres (`export_artifacts`, the default on Vercel) and purged after
  `WP_EXPORT_TTL_HOURS`.
- **Privacy.** `POST /v1/privacy/delete-request` revokes all sessions (denylist by `sub` and `iat`), disables
  notifications, soft-deletes the user and household, and schedules erasure after `WP_ERASURE_DELAY_DAYS`.
- **Logging.** JSON lines with request ID, method, route template, status and duration. No bodies, query strings,
  amounts or names are logged; audit-event metadata is whitelisted.

## Container

```bash
docker build -f services/api/Dockerfile -t wealthpilot-api .     # from the repo root
docker run --env-file services/api/.env -p 8000:8000 wealthpilot-api
docker run --env-file services/api/.env wealthpilot-api python -m wealthpilot_api.worker
docker run --env-file services/api/.env wealthpilot-api alembic upgrade head
```

## Deploying to Vercel

The API is its own Vercel project with Root Directory `services/api`; the web app will be a separate project on its
own domain. Vercel detects FastAPI from `pyproject.toml`, installs dependencies from `uv.lock` with
`uv sync --frozen --no-dev --no-editable` (which builds the `packages/calculation_engine` path dependency into the
function as a normal package, so nothing is vendored by hand), runs `scripts/vercel_build.py` (the
`[tool.vercel.scripts] build` entry) and serves every path (`/v1/*`, `/healthz`, `/readyz`) from the single
function defined by `index.py`. Python is pinned to 3.12 by `.python-version`.

### One-time setup (dashboard)

1. **Import the repo.** vercel.com → **Add New… → Project** → **Import** the GitHub repository.
2. **Configure the project** before the first deploy:
   - **Project Name**: e.g. `wealthpilot-api`.
   - **Root Directory**: **Edit** → choose `services/api`. Keep **Include files outside the root directory in the
     Build Step** enabled (the default for new projects; the build reads `packages/calculation_engine`).
   - **Framework Preset**: FastAPI (detected; also pinned in `vercel.json`). Do not override the Build, Install or
     Output commands: a dashboard Build Command replaces `scripts/vercel_build.py`.
   - **Environment Variables**: add the ones in the table below. At minimum `WP_SECRET_KEY`, `WP_OIDC_ISSUER`,
     `WP_OIDC_JWKS_URL` and `CRON_SECRET` for Production, and `WP_SECRET_KEY` for Preview. A build with missing
     or unsafe settings fails with a message saying which.
   - Click **Deploy**. The first deployment works without a database (`/healthz` is 200, `/readyz` is 503).
3. **Add the database.** In the project: **Storage** → **Create Database** → **Neon** (Serverless Postgres,
   Vercel Marketplace) → accept the terms, pick a region next to the function region (Settings → Functions; the
   default is Washington, D.C. `iad1`, so choose Neon's AWS US East 1) and a plan → **Create**. Then
   **Connect Project** → this project, environments Development, Preview and Production. Recommended under
   **Advanced Options**: enable **Preview** branching (each preview deployment gets its own copy-on-write Neon
   branch, so preview builds never migrate the production database) and **Resource must be active before
   deployment**. Neon injects `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct) and legacy `POSTGRES_*`
   variables; the API uses the pooled URL at runtime and the direct one for migrations.
4. **Redeploy** (Deployments → ⋯ → Redeploy, or push to `main`). The build log shows
   `[wealthpilot build] env=production auth=oidc storage=postgres inline_jobs=True pool_size=0`,
   `running alembic upgrade head` and `migrations complete`. Check `https://<project>.vercel.app/healthz`,
   `/readyz` (database reachable) and `/v1/docs`.
5. **Cron.** `vercel.json` registers `GET /v1/internal/cron/daily` at 05:00 UTC (notifications, maintenance, then
   a sweep) and `GET /v1/internal/cron/sweep` at 17:00 UTC (retries, stuck jobs, scheduled erasures). Vercel runs
   them against the production deployment only; both fit the Hobby plan (once a day each; Hobby may fire any time
   within the hour). Vercel sends `Authorization: Bearer $CRON_SECRET`; without `CRON_SECRET` the endpoints answer
   401. Try one from Settings → Cron Jobs → **Run**. On Pro you can add a more frequent sweep (e.g.
   `*/10 * * * *`).
6. **Domain (optional).** Settings → Domains → add `api.<your-domain>`.

### Environment variables

| Variable | Environments | Value |
|---|---|---|
| `WP_SECRET_KEY` | Production, Preview | Random, 32+ characters (`openssl rand -hex 32`), different per environment. Signs download links. |
| `WP_OIDC_ISSUER` | Production, Preview | Clerk **Frontend API URL**, exactly as the token's `iss` (no trailing slash): `https://clerk.<your-domain>` for a production instance, `https://<slug>.clerk.accounts.dev` for a development instance (Clerk dashboard → API keys). |
| `WP_OIDC_JWKS_URL` | Production, Preview | `<Frontend API URL>/.well-known/jwks.json` |
| `WP_OIDC_AUDIENCE` | optional | Only when a Clerk JWT template sets `aud`; default session tokens have none. |
| `WP_OIDC_AUTHORIZED_PARTIES` | Production, Preview | Comma list of web-app origins accepted in `azp`, e.g. `https://app.<your-domain>`. Tokens without `azp` (the native app) are still accepted. Leave empty until the web app exists. |
| `CRON_SECRET` | Production | Random, 16+ characters. Vercel sends it to the cron endpoints. |
| `WP_CORS_ORIGINS` | Production, Preview | Web-app origins, e.g. `https://app.<your-domain>`. The mobile app needs no CORS. |
| `WP_CORS_ORIGIN_REGEX` | Preview, optional | Web-app preview URLs, e.g. `https://wealthpilot-web-[a-z0-9-]+-<team>\.vercel\.app` |
| `WP_REVENUECAT_WEBHOOK_SECRET` | Production | Once RevenueCat is set up. |
| `WP_EXPO_PUSH_ENABLED`, `WP_EXPO_ACCESS_TOKEN` | Production | `1` and the Expo access token, to send push notifications. |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | all | Injected by the Neon integration; nothing to do. `WP_DATABASE_URL` / `WP_MIGRATION_DATABASE_URL` override them. |

Defaults applied on Vercel unless set explicitly: `WP_ENV` = `production` when `VERCEL_ENV=production`, `staging`
for previews; `WP_INLINE_JOBS=1`; `WP_STORAGE_BACKEND=postgres`; `WP_DB_POOL_SIZE=0`. `WP_AUTH_MODE` defaults to
`oidc`; `dev` is refused on production and preview deployments. `WP_SKIP_MIGRATIONS=1` skips the build-time
migration.

### How it runs

- **Jobs.** Scenario runs and exports execute inside the request (`WP_INLINE_JOBS=1`; a run takes well under a
  second). A failed job is retried with backoff by the next cron sweep; a job left `running` by a function that
  was stopped mid-way is requeued by the sweep after 15 minutes. There is no worker process on Vercel.
- **Database.** No in-process pool (`NullPool`): Neon's PgBouncer (the `-pooler` host in `DATABASE_URL`) pools
  connections, and psycopg's automatic prepared statements are turned off for pooler hosts. psycopg's binary
  wheel (with libpq) is installed for the Linux x86_64 runtime.
- **Migrations** run during the build against `DATABASE_URL_UNPOOLED`, under a Postgres advisory lock so parallel
  builds don't race, and are skipped (the build still succeeds) when no database is connected. Migrations are safe
  to re-run.
- **Exports** live in the `export_artifacts` table and expire with the export (`WP_EXPORT_TTL_HOURS`).
- **Limits.** `vercel.json` sets `maxDuration` to 60 s; a cron run stops taking new jobs after 45 s and the next
  run continues.

### Pointing the mobile app at it

In `apps/mobile/.env` (or the EAS build profile's `env`):

```bash
EXPO_PUBLIC_API_URL=https://<project>.vercel.app/v1     # or https://api.<your-domain>/v1
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...           # the same Clerk instance as WP_OIDC_ISSUER
EXPO_PUBLIC_DEV_AUTH=0
```

Use the production URL. Preview deployments are behind Vercel Deployment Protection by default, which the app
cannot get through. Native requests need no CORS.

### Simulating the build locally

```bash
cd services/api
uv run python scripts/vercel_build.py      # validate settings, check imports, migrate when a DB URL is set
npx vercel@latest build                    # optional; needs `vercel link` (or a .vercel/project.json); deploys nothing
```
