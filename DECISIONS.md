# Decisions

Product and engineering decisions for WealthPilot. Ambiguities are recorded here rather than silently invented (spec §18.1 rule 10).

## 2026-10-10 — Release 1 scope and stack (approved by AK)

| Topic | Decision |
|---|---|
| Audience | Public app (App Store / Google Play), not a personal tool. |
| Platform order | Mobile first (Expo / React Native, iOS + Android); Next.js web portal follows and reuses the API and contracts. |
| MVP scope | All of spec §2.1 (release 1), not only the §24 vertical slice. |
| Backend | Spec stack: FastAPI + Pydantic v2 + SQLAlchemy 2 + Alembic on PostgreSQL 16. Modular monolith. Calculation engine is a separate pure-Python package (`packages/calculation_engine`) with no I/O. |
| Jobs | Postgres-backed job queue (`FOR UPDATE SKIP LOCKED`) with an idempotent worker process, instead of Redis/Celery. Fewer moving parts for release 1; Redis can be added for rate limiting later. |
| Sign-in | Hosted OIDC provider. Default: Clerk (Google, Apple, Microsoft, email code, passkeys, optional TOTP MFA). The API only verifies OIDC JWTs via JWKS, so the provider is swappable (Auth0, Cognito, Supabase). No password handling in our code. |
| FX | Users enter the USD/INR rate they want to plan with. A free ECB-based reference rate (frankfurter.app) is shown as a suggestion, labelled non-licensed, and is never used in calculations unless saved by the user. A licensed feed is needed before relying on automatic rates. |
| Household sharing | Single user for release 1; the data model already has households and memberships. Invites return 501. |
| Taxes | No tax rules ship. Every tax figure is a user-entered illustrative rate (`rulepack_version = "none-1"`). |
| Subscriptions | Entitlements enforced server-side (spec §12 free-tier limits). Store billing via RevenueCat webhook; paywall UI ships, purchase flow activates once store products exist. |
| Object storage | Exports go through a storage interface: local disk in dev, S3-compatible bucket in production. |
| Monorepo | pnpm workspaces for TypeScript (`apps/*`, `packages/contracts`), uv for Python (`services/api`, `packages/calculation_engine`). |

## Open items needing AK or expert input

- Legal/tax review of disclaimers and all copy before public launch (spec §11.3).
- ~~Choose hosting~~ Vercel chosen (see 2026-10-11 below). Still to do: buy the Apple/Google developer accounts.
- Create the Clerk application and enable the social providers; set the keys in `.env`.
- Licensed FX/price provider before offering automatic rates.

## 2026-10-10 — Mobile app implementation choices (assumptions, pending review)

| Topic | Decision |
|---|---|
| Clerk SDK | `@clerk/expo` (current SDK); `@clerk/clerk-expo` is deprecated. Passkeys via `@clerk/expo-passkeys`, loaded only when `EXPO_PUBLIC_CLERK_PASSKEYS=1` (needs a dev/store build and associated domains). |
| Dev sign-in | Shown only when no Clerk key is set and `EXPO_PUBLIC_DEV_AUTH=1`; clearly labelled; sends `dev:<subject>:<email>`. |
| Goal progress | `progress.pct` is read as a fraction (0.05 = 5%), consistent with every other rate in the contract. |
| RSU vest `version` | Treated as optional in the client types; sent for optimistic concurrency when present. |
| Charts | Custom `react-native-svg` charts (bundle on iOS, Android and web) with a data-table toggle on every chart, instead of a charting library. |
| Offline cache | TanStack Query persisted to AsyncStorage for 24 h, read-only; only non-sensitive-to-display list/detail reads are persisted, writes are never queued, and sign-out clears it plus the push registration. Values are financial data at rest in app storage; revisit (encrypt or shorten) after security review. |
| Comparisons | `POST /comparisons` is treated as a read (cached query), since it computes over stored runs and writes nothing. |
| Insights exposure thresholds | Client exposure indicators use fixed thresholds (medium ≥ 25%, high ≥ 50% of gross assets; liquidity medium < 25%, high < 10%), shown beside the indicator. Not advice. |
| Purchases | Subscription screen shows §12 tiers with "proposed" prices; purchase buttons say "coming soon" until RevenueCat products exist. |

## 2026-10-11 — Hosting on Vercel (requested by AK)

Web app, database and backend all run on Vercel. Setup steps are in [`services/api/README.md`](services/api/README.md#deploying-to-vercel).

| Topic | Decision |
|---|---|
| API runtime | Separate Vercel project, Root Directory `services/api`, FastAPI on Vercel's Python runtime (Fluid compute), Python 3.12 (`.python-version`). One function from `index.py` serves every path; `maxDuration` 60 s. |
| Monorepo dependency | Vercel installs from `uv.lock` with `uv sync --frozen --no-dev --no-editable`, which builds the `packages/calculation_engine` path dependency into the function bundle (verified with `vercel build`). Needs the default "Include files outside the root directory in the Build Step". No vendoring or generated `requirements.txt`. |
| Database | Neon Postgres from the Vercel Marketplace. The API reads `DATABASE_URL` / `POSTGRES_URL` when `WP_DATABASE_URL` is unset (URLs rewritten to `postgresql+psycopg://`), uses Neon's pooled URL with no in-process pool (`NullPool`) and no automatic prepared statements, and migrates over `DATABASE_URL_UNPOOLED`. Neon preview branching is recommended so previews never touch production data. |
| Migrations | `alembic upgrade head` runs in the Vercel build (`scripts/vercel_build.py`) under a Postgres advisory lock; skipped when no database is connected. The build also fails on unsafe settings (dev auth, missing secret, missing OIDC config) instead of deploying a broken function. |
| Jobs | No worker process: on Vercel jobs run inline in the request (`WP_INLINE_JOBS=1`; scenario runs take < 1 s). Two Vercel Cron jobs (daily, Hobby-compatible) call `/v1/internal/cron/daily` (notifications + maintenance + sweep) and `/v1/internal/cron/sweep` (retries, stuck jobs, scheduled erasures), guarded by `CRON_SECRET` and excluded from the OpenAPI document. The standalone worker stays for container hosts. |
| Exports | New `postgres` storage backend (`export_artifacts` table, bytea, expiring with the export) is the default on Vercel since functions have no persistent disk. `local` and `s3` remain. |
| Auth | Production uses Clerk via OIDC. `WP_ENV` defaults to `production` on Vercel production and `staging` on previews; dev auth is refused on every Vercel production/preview deployment. Optional `azp` check against `WP_OIDC_AUTHORIZED_PARTIES` (skipped when the claim is absent, as Clerk documents, e.g. native-app tokens). |
| CORS | The web app gets its own Vercel project/domain: `WP_CORS_ORIGINS` plus optional `WP_CORS_ORIGIN_REGEX` for its preview URLs. |
| Kept | Dockerfile, `python -m wealthpilot_api.worker`, local/S3 storage and `scripts/dev-db.sh` are unchanged for other hosts and local development. |

Open: on the Hobby plan cron fires once a day (any time within the hour), so a failed inline job waits up to ~12 h for its retry; move to Pro and add a frequent sweep if that matters. Hobby is for personal, non-commercial use, so a public app needs Pro.

