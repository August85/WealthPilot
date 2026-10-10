# WealthPilot API

FastAPI modular monolith plus a Postgres-backed job worker. Implements [`docs/api-contract.md`](../../docs/api-contract.md);
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
  worker.py          python -m wealthpilot_api.worker [--once]
  core/              settings, DB, errors, request context, idempotency middleware, shared schema types
  modules/
    auth/            OIDC JWT verification (JWKS, cached), dev tokens, user provisioning, household scope
    households/      /me, onboarding, tax residency, security events, households
    accounts/        accounts, append-only valuations, net worth, history, insights
    market_data/     user FX rates, frankfurter reference rates, manual prices
    equity/          RSU grants, vests, dispositions, calendar
    goals/  scenarios/  reports/  notifications/  billing/  privacy/  compliance/  jobs/  health/
alembic/             migrations (0001 = full initial schema, triggers for immutable rows)
```

## Behaviour notes

- **Auth.** `Authorization: Bearer <JWT>` verified against `WP_OIDC_JWKS_URL` (asymmetric algorithms only; `iss`,
  `exp`, `iat`, `sub` required; `aud` when `WP_OIDC_AUDIENCE` is set). The first call provisions the user.
  `WP_AUTH_MODE=dev` additionally accepts `Bearer dev:<subject>:<email>` and is refused when `WP_ENV=production`.
- **Tenancy.** Every query is scoped to the caller's household; other households' resources return 404.
- **Concurrency.** Mutable rows carry `version`; a stale `version` in a PATCH returns 409 `VERSION_CONFLICT`.
  `Idempotency-Key` on POSTs is scoped per user; a replay returns the stored response with
  `Idempotent-Replayed: true`, the same key with a different body returns 422 `IDEMPOTENCY_KEY_REUSED`.
- **Immutability.** Valuations are append-only (corrections supersede) and scenario versions are immutable, both
  enforced by Postgres triggers. Runs store their full result; results and exports never recompute.
- **Jobs.** `jobs` table claimed with `FOR UPDATE SKIP LOCKED`; failures retry with exponential backoff
  (2^attempt s, max 1 h) up to `WP_JOB_MAX_ATTEMPTS`, then are dead-lettered (`failed`) and the run/export is
  marked failed. The worker enqueues `daily_notifications` and `daily_maintenance` once per UTC day.
- **Exports.** CSV/JSON for balances and assumptions, CSV/JSON/PDF for a run. Download links are HMAC-signed and
  valid 15 minutes (`GET /v1/exports/{id}/download?token=`); free-plan PDFs are watermarked. Artifacts are
  stored locally or in S3 (SSE) and purged after `WP_EXPORT_TTL_HOURS`.
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
