# WealthPilot

Cross-border (US–India) financial planning: multi-currency net worth, RSUs, 401(k), EPF, FDs, home purchase and retirement scenarios. See [`spec.md`](spec.md) for the product spec, [`DECISIONS.md`](DECISIONS.md) for decisions, and [`docs/api-contract.md`](docs/api-contract.md) for the API.

> WealthPilot is planning software. It is not tax, legal or investment advice.

## Layout

```
apps/mobile/                  Expo / React Native app (iOS + Android)
apps/web/                     Next.js web app (same features and API as mobile; deploys to Vercel)
services/api/                 FastAPI modular monolith + worker
packages/calculation_engine/  Pure-Python financial calculations (golden-tested)
packages/contracts/           OpenAPI document + generated TypeScript types + API client
packages/shared/              Platform-neutral TS shared by mobile and web (money, dates, form schemas, labels)
docs/                         API contract, ADRs
```

## Run it locally

Requirements: Python 3.12+ with [uv](https://docs.astral.sh/uv/), Node 22 with pnpm 10, and PostgreSQL 16 (or Docker).

```bash
# 1. Database (Docker if available, else a local cluster on 127.0.0.1:55432)
scripts/dev-db.sh up && scripts/dev-db.sh migrate

# 2. API on :8000 with dev sign-in (never enable dev auth in production)
cd services/api && cp .env.example .env && uv sync
uv run uvicorn wealthpilot_api.main:app --reload --port 8000
uv run python scripts/seed_dev.py            # optional: fictional spec §16 household for user "demo"

# 3. Mobile app
cd apps/mobile && cp .env.example .env && cd ../.. && pnpm install
pnpm mobile:start                             # Expo Go / dev build; press w for web
```

With no Clerk key set and `EXPO_PUBLIC_DEV_AUTH=1`, the app shows a labelled **Dev sign-in**; use subject `demo` and email `demo@example.test` to see the seeded household.

### Web app

```bash
cd apps/web && cp .env.example .env.local     # NEXT_PUBLIC_API_URL, NEXT_PUBLIC_DEV_AUTH=1 for local dev sign-in
pnpm web:dev                                  # http://localhost:3000
pnpm web:build && pnpm web:start              # production build
```

The API must allow the web origin: start it with `WP_CORS_ORIGINS=http://localhost:3000`. As on mobile, dev sign-in appears only when no Clerk key is set and `NEXT_PUBLIC_DEV_AUTH=1`; set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to use Clerk. The app builds without any keys.

**Vercel:** import the repository, set *Root Directory* to `apps/web` (framework Next.js, install and build commands auto-detected for the pnpm workspace) and set `NEXT_PUBLIC_API_URL` plus the Clerk keys in the project's environment variables.

## Checks

```bash
(cd packages/calculation_engine && uv run pytest -q)   # golden vectors and calculation tests
(cd services/api && uv run pytest -q)                  # API tests against Postgres
pnpm check                                             # contracts, shared, mobile and web: typecheck, lint, tests
pnpm web:build                                         # Next.js production build (no keys needed)
```

The web app also has an end-to-end run against the real API and a browser (not in CI): see [`apps/web/e2e/README.md`](apps/web/e2e/README.md).

CI runs all of these on every pull request (`.github/workflows/ci.yml`).

## Hosting

Step-by-step setup for AK: [`DEPLOY.md`](DEPLOY.md).

Everything runs on Vercel: the API is a Vercel project with Root Directory `services/api` (FastAPI on Vercel's
Python runtime, inline jobs plus Vercel Cron), the database is Neon Postgres added from the Vercel Marketplace, and
the web app will be its own Vercel project. Step-by-step setup, environment variables and how to point the mobile
app at the deployed API: [`services/api/README.md#deploying-to-vercel`](services/api/README.md#deploying-to-vercel).
The API's Dockerfile and standalone worker still work on container hosts.
