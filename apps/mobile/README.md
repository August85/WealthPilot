# WealthPilot mobile

The Expo / React Native app for WealthPilot, a US–India cross-border financial planner. It runs on iOS and Android, and on web for development. It talks only to the WealthPilot API (`docs/api-contract.md`) through the typed client in `packages/contracts`.

The stack is Expo SDK 57, Expo Router, TypeScript, TanStack Query (with a persisted read-only offline cache), Zustand (ephemeral UI state only), React Hook Form with Zod, decimal.js for all money math, react-native-svg charts, Clerk auth, expo-secure-store, expo-local-authentication and expo-notifications.

## Run it

You need Node 22 or newer and pnpm 10. Run these from the repo root:

```bash
pnpm install
cp apps/mobile/.env.example apps/mobile/.env   # then edit it
pnpm mobile:start          # Expo dev server (press i / a / w)
pnpm mobile:web            # web companion in the browser
```

Before you sign in, start the API (`services/api`; see its README).

### Expo Go vs a development build

| Works in Expo Go | Needs a development build (`eas build --profile development`) |
|---|---|
| Dev sign-in, Google, Apple and Microsoft SSO through the browser, email code, all screens | Passkeys (`@clerk/expo-passkeys`), Sign in with Apple native sheet, push notifications, reliable biometric lock |

The workspace uses `node-linker=hoisted` (`.npmrc`) so Metro resolves packages the same way it does in a single-package app. No custom Metro config is needed.

### Checks

```bash
pnpm mobile:typecheck      # tsc --noEmit
pnpm mobile:lint           # expo lint (eslint-config-expo, flat config)
pnpm mobile:test           # jest-expo + React Native Testing Library
pnpm mobile:export         # expo export for web, ios and android into apps/mobile/dist/
pnpm check                 # contracts + mobile typecheck, lint and tests
```

## Environment variables

Only `EXPO_PUBLIC_*` variables reach the bundle, so never put secrets in them. See `.env.example`.

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | API base URL including `/v1`. Default `http://localhost:8000/v1`. On a phone, use your computer's LAN IP. On the Android emulator, use `http://10.0.2.2:8000/v1`. |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key. When set, the app uses Clerk. |
| `EXPO_PUBLIC_CLERK_JWT_TEMPLATE` | Optional Clerk JWT template name. Leave it empty to use the default session token. |
| `EXPO_PUBLIC_CLERK_PASSKEYS` | Set to `1` to load the native passkey module. Development or store builds only. |
| `EXPO_PUBLIC_DEV_AUTH` | Set to `1` with no Clerk key to show the **Dev sign-in** screen. It sends `dev:<subject>:<email>` bearer tokens, and the API must have dev auth enabled. Never set this in production. |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | EAS project ID, used for Expo push tokens. |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY` | RevenueCat public SDK keys. Purchasing shows "coming soon" until store products exist. |

If there is no Clerk key and dev auth is off, the welcome screen says that sign-in is not configured.

## Clerk setup (Google, Apple, Microsoft, email code, passkeys)

1. Create a Clerk application and copy the **publishable key** into `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`. The API verifies the same instance's JWTs through JWKS. Configure the issuer in the API's environment.
2. **Email code:** go to *User & Authentication → Email*, enable *Email verification code*, and set sign-in to email code (no passwords).
3. **Google:** go to *SSO connections → Google*. For production, use your own Google OAuth client (web client ID and secret in Clerk).
4. **Microsoft:** go to *SSO connections → Microsoft*. For production, register an Entra ID app and add Clerk's redirect URI to it.
5. **Apple:** go to *SSO connections → Apple*. Add your Apple Services ID, Team ID, Key ID and private key in Clerk. Apple sign-in is offered on iOS and web, and `usesAppleSignIn` is already set in `app.json`.
6. **Redirect URLs:** SSO returns to `wealthpilot://sso-callback`. Add that URL to Clerk's allowed redirect URLs under *Native applications*, and register the iOS bundle ID and Android package `com.wealthpilot.app` there.
7. **Passkeys:** enable passkeys in Clerk. Then set up the native associated domains:
   - Add `ios.associatedDomains: ["webcredentials:<your-clerk-frontend-api-domain>"]` to `app.json`.
   - Set up Android asset links for the same domain.
   - Make a development build with `EXPO_PUBLIC_CLERK_PASSKEYS=1`.

   The EAS profiles leave passkeys off until you have done this.

The app uses `@clerk/expo`, the current Clerk Expo SDK. `@clerk/clerk-expo` is its deprecated predecessor. The session token cache lives in SecureStore (`@clerk/expo/token-cache`). Every API request sends the Clerk session JWT as `Authorization: Bearer <token>`.

## Behaviour notes

- **Money:** values stay decimal strings end to end. All client math uses decimal.js and is for previews only, because the API is authoritative.
  - USD displays as `$1,234,567.89`.
  - INR uses Indian grouping: `₹12,34,567.89`.
  - The optional short forms (`₹12.35 L`, `₹1.23 Cr`, `$1.23M`) are always marked as approximate.
- **Forecasts:** every forecast card shows *As of*, *Scenario*, *Assumptions* (version and input hash) and *Illustrative*. Unverified figures have dashed outlines and a "?" icon, and stale figures have a clock icon. Colour is never the only signal.
- **Errors:**
  - A `402 PLAN_LIMIT` response opens the Subscription screen.
  - A `409 VERSION_CONFLICT` response opens a resolve prompt. Nothing is overwritten.
  - All POSTs carry an `Idempotency-Key`.
- **Offline:** the last successful reads are kept in AsyncStorage for 24 hours and shown read-only behind an offline banner. Writes are disabled while offline and are never queued. Signing out clears this cache, the in-memory query cache and the push registration.
- **Analytics:** a no-op sink with a typed allow-list (`src/lib/analytics.ts`). It never receives amounts or personal data.
- **Accessibility:**
  - Every chart has a "Show data table" toggle.
  - Controls have labels and roles, and touch targets are at least 44pt.
  - Text supports Dynamic Type up to a capped multiplier.
  - The colour palette follows spec §17, with AA contrast in light and dark themes.

## Layout

```
src/app/            Expo Router routes (thin re-exports of feature screens)
src/features/       Screens by area: auth, onboarding, overview, accounts, rsu, fx, plan, goals, scenarios, insights, profile, help
src/components/     Primitives, form fields, finance components, charts
src/lib/            API provider, query client and keys, hooks, auth, money/decimal/date helpers, push, biometrics, analytics
src/store/ui.ts     Zustand (display currency override, compact amounts, conflict prompt, unlock state)
src/test/           Mock API (real client over a mocked fetch) and contract-shaped fixtures
```

## EAS

`eas.json` defines these build profiles:

- `development`: a dev client for internal distribution, with dev auth allowed.
- `development-simulator`: the same, built for the iOS simulator.
- `preview`: internal distribution, using Clerk only.
- `production`: store builds with auto-incremented build numbers.

To set up and build:

1. Run `eas init`. This writes `extra.eas.projectId` into the app config. You can set `EXPO_PUBLIC_EAS_PROJECT_ID` instead.
2. Set the production variables as EAS environment variables or secrets, not in `eas.json`:
   - `EXPO_PUBLIC_API_URL`
   - `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - the RevenueCat keys
3. Run `eas build --profile development --platform ios` (or `android`), then `pnpm mobile:start`.
4. To submit, run `eas build --profile production` and then `eas submit`.

You need Apple and Google developer accounts, and push credentials (APNs key and FCM) set up through `eas credentials`.

The bundle identifier and Android package are both `com.wealthpilot.app`.
