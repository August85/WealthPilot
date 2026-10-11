# Deploying WealthPilot to Vercel

Two Vercel projects are imported from this one repository, and both share one Neon Postgres database:

| Project | Root Directory | Serves |
|---|---|---|
| `wealthpilot-api` | `services/api` | The API (`/v1/...`) used by the web app and the iPhone app |
| `wealthpilot-web` | `apps/web` | The web app |

The phone and the web app talk to the same API and database, so they always show the same data.
Full details: [`services/api/README.md`](services/api/README.md#deploying-to-vercel) and [`apps/web/.env.example`](apps/web/.env.example).

## Before you start

- Clerk app created. Development instance Frontend API: `https://magical-coral-4209.clerk.accounts.dev`.
- Two random secrets. Generate each with `openssl rand -hex 32`, or use any password generator with 32+ characters:
  `WP_SECRET_KEY` and `CRON_SECRET`.

## 1. API project

1. vercel.com → **Add New… → Project** → import `August85/WealthPilot`.
2. **Project Name** `wealthpilot-api`. **Root Directory** → Edit → `services/api`. Leave the build settings alone; FastAPI is detected.
3. **Environment Variables** (Production and Preview):

   | Name | Value |
   |---|---|
   | `WP_SECRET_KEY` | your first random secret |
   | `CRON_SECRET` | your second random secret (Production only) |
   | `WP_OIDC_ISSUER` | `https://magical-coral-4209.clerk.accounts.dev` |
   | `WP_OIDC_JWKS_URL` | `https://magical-coral-4209.clerk.accounts.dev/.well-known/jwks.json` |

4. **Deploy.** It deploys without a database: `/healthz` returns ok, and `/readyz` returns 503 until step 5.
5. In the project open **Storage → Create Database → Neon**. Pick region **AWS US East 1** and **Connect Project** for Development, Preview and Production.
   Under Advanced Options turn on **Preview branching**.
6. **Deployments → ⋯ → Redeploy.** The build log ends with `migrations complete`.
   Open `https://<api-project>.vercel.app/readyz`; it should say ok.

## 2. Web project

1. **Add New… → Project** → import the same repo again.
2. **Project Name** `wealthpilot-web`. **Root Directory** → `apps/web`. Framework Next.js is detected.
3. **Environment Variables** (Production and Preview):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<api-project>.vercel.app/v1` |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | your `pk_test_…` key |
   | `CLERK_SECRET_KEY` | your `sk_test_…` key. This is the only place the secret key goes. |

4. **Deploy**, and note the web URL, e.g. `https://wealthpilot-web.vercel.app`.

## 3. Connect the two

In the **API** project → Settings → Environment Variables, add the following, then redeploy the API:

| Name | Value |
|---|---|
| `WP_CORS_ORIGINS` | the web URL from step 2.4 |
| `WP_OIDC_AUTHORIZED_PARTIES` | the same web URL |


## 4. Point the iPhone app at the hosted API

In `apps/mobile/.env` set:

- `EXPO_PUBLIC_API_URL=https://<api-project>.vercel.app/v1`
- `EXPO_PUBLIC_DEV_AUTH=0`

Then rebuild the app. Use the production URL: preview deployments are behind Vercel login protection.

## Notes

- **Plan.** As we understand Vercel's terms, Hobby (free) is for personal, non-commercial use, so move to Pro before a public launch; this wasn't checked against Vercel's current terms. Hobby also limits cron jobs to once a day.
- **Going live.** For a live launch, create a Clerk **production** instance on your own domain, and swap its keys and Frontend API URL into the variables above.
