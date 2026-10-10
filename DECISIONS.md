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
- Choose hosting (e.g. Fly.io, Render, AWS) and buy the Apple/Google developer accounts.
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

