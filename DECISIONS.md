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
| Goal progress | ~~`progress.pct` is read as a fraction~~ Superseded 2026-10-11: the API returns a percentage 0-100 capped at 100 (`goals/router.py`), like `ownership_pct`; both clients now read it as a percentage. |
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


## 2026-10-11 — Web app stack and implementation choices (assumptions, pending review)

| Topic | Decision |
|---|---|
| Framework | Next.js 16 App Router (Turbopack, React Compiler on, React 19.2) in `apps/web`, deployed on Vercel with Root Directory `apps/web`. Every page is a client-rendered screen behind a thin route file; the server renders only the shell, so no financial data passes through Next.js servers. |
| Shared code | Platform-neutral logic moved from mobile into `packages/shared` (decimal/money formatting, dates, labels, form schemas and builders, assumption catalogue, result helpers, analytics scrubbing). Mobile re-exports it, so both apps format and validate identically. |
| UI kit | Tailwind CSS 4 with design tokens on `:root`/`.dark` (light, dark, system), Radix primitives (`radix-ui`), lucide icons, Recharts 3 (every chart has a "Show data table" toggle), sonner toasts, Inter via Fontsource (self-hosted, no Google Fonts request). Text-on-colour pairs use darker/lighter shades of the same hue to meet WCAG AA. |
| Middleware | `src/proxy.ts` (Next 16 rename of middleware) sets a per-request nonce CSP (`script-src 'nonce-…' 'strict-dynamic'`, `connect-src` limited to self, the API origin and Clerk) and, when Clerk is configured, protects app routes server-side. Static headers (HSTS, frame-ancestors deny, nosniff, Referrer-Policy, Permissions-Policy) come from `next.config.ts`. |
| Auth | Clerk Core 3 (`@clerk/nextjs` 7): prebuilt `SignIn`/`SignUp` at `/sign-in`, `/sign-up`; passkeys and MFA via Clerk's user profile. With no Clerk key and `NEXT_PUBLIC_DEV_AUTH=1` a labelled dev sign-in sends `dev:<subject>:<email>`; the token lives in `sessionStorage` (this tab only). With neither, sign-in shows "authentication not configured" — `next build` works without any keys. |
| Storage | No financial data in browser storage: server data lives only in the TanStack Query memory cache, which is reset whenever the signed-in identity changes. `localStorage` holds only viewer preferences (theme, short amounts). |
| Live sync | Queries refetch on window focus and reconnect; overview, accounts and notifications also poll every 30 s while the tab is visible. Every mutation invalidates the queries it affects. |
| Conflicts | Edit forms capture the entity `version` when opened (`baseVersion`) and background refetches never bump it; a newer server version shows "changed on another device". A 409 `VERSION_CONFLICT` opens a resolve dialog (load latest / keep editing) and never retries or overwrites (no last-write-wins). |
| Plan limits | 402 `PLAN_LIMIT` from any request routes to `/subscription?reason=…`. |
| Analytics | Same no-op sink as mobile; props are scrubbed of amounts, ids and PII before any sink would see them. |
| FX on a new account | `GET /fx/rates` answers 404 `FX_RATE_MISSING` until the user saves a rate; the UI treats that as "no rate yet" and prompts for one. The public reference rate (`/fx/reference`) may answer 503 when the upstream provider is unreachable; the FX page says so and never uses the reference rate unless the user saves it. |
| Home section | Switching on a home purchase for a scenario whose server defaults have `home: null` (any new household) starts from the engine's neutral defaults (zero optional costs, 30-year term, default funding sources); price, purchase date, down payment and mortgage rate stay empty for the user to enter. Previously this could not pass validation. Applies to mobile too (shared code). |
| Testing | Vitest + Testing Library for units, schemas, API wiring and screen renders; `apps/web/e2e/run.mjs` (Playwright, not in CI) drives the production build against the real API — see `apps/web/e2e/README.md`. |
