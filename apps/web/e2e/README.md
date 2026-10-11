# Web end-to-end check (real API)

`e2e/run.mjs` drives the production build of the web app in Chromium against a real API and database. It is
not part of CI (it needs Postgres, the API and a browser); run it before releases and after larger UI changes.

## What it checks

1. **Demo sweep** (seeded user `demo`): every page — overview, accounts (list, add, detail, EPF), RSU (list,
   new, editor, calendar), FX, goals, scenarios (list, new, editor), run results, explain, compare, home and
   retirement planners, insights, notifications, export, settings (general, residency, security),
   subscription, help and the 404 page — at 1440×900 and again at 390×844. Each must render a heading, show
   no error state, have no horizontal page scroll, and produce no console errors, page errors or HTTP 4xx/5xx.
   Also opens and uses the phone navigation drawer.
2. **New user**: dev sign-in as a fresh subject → onboarding (residency + not-advice acknowledgement +
   household) → save USD/INR rate 85 → add an INR fixed deposit (₹8,50,000.50, verified) → overview shows
   $10,000.01 → create a home scenario, enter salary, expenses and home inputs, save version 2 → save and run
   → results with As of / Scenario / Assumptions / Illustrative labels → export the run as PDF and download it.
3. **Screenshots** of overview, accounts, scenario editor, run results and compare at 1440×900 and 390×844.

Expected, handled failures that are not reported:

- `GET /v1/fx/reference` → **503** when the upstream reference-rate provider is unreachable; the FX page
  says the reference rate is unavailable (the user's own saved rate is the only rate used in calculations).
- `GET /v1/fx/rates` → **404 FX_RATE_MISSING** for a brand-new user, only until the rate is saved; the UI
  prompts for a rate. The browser logs both as "Failed to load resource" console errors, so the runner
  allow-lists exactly these.

## Run it

From the repository root:

```bash
# 1. Database (reuses a server already on 127.0.0.1:55432)
scripts/dev-db.sh up && scripts/dev-db.sh migrate
#    Optional: an isolated database, e.g. when another checkout migrated the shared one further:
#    psql -h 127.0.0.1 -p 55432 -U postgres -c "CREATE DATABASE wealthpilot_web_e2e"
#    export WP_DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55432/wealthpilot_web_e2e
#    scripts/dev-db.sh migrate

# 2. API with dev auth and inline jobs (use another port if 8000 is taken, and match NEXT_PUBLIC_API_URL)
cd services/api && uv sync
WP_AUTH_MODE=dev WP_INLINE_JOBS=1 WP_CORS_ORIGINS=http://localhost:3000 \
  uv run uvicorn wealthpilot_api.main:app --port 8000 &
WP_AUTH_MODE=dev uv run python scripts/seed_dev.py      # user "demo", demo@example.test
cd ../..

# 3. Web app (production build, dev sign-in, no Clerk keys)
cd apps/web
NEXT_PUBLIC_DEV_AUTH=1 NEXT_PUBLIC_API_URL=http://localhost:8000/v1 pnpm build
NEXT_PUBLIC_DEV_AUTH=1 NEXT_PUBLIC_API_URL=http://localhost:8000/v1 pnpm start &

# 4. Run (screenshots and the downloaded PDF go to E2E_OUT; keep it outside the repository)
E2E_OUT=/tmp/wealthpilot-web-e2e node e2e/run.mjs            # everything
node e2e/run.mjs --only sweep                                 # or: new-user, screens
```

| Variable | Default | Meaning |
|---|---|---|
| `E2E_WEB_URL` | `http://localhost:3000` | Web app origin |
| `E2E_API_URL` | `http://localhost:8000/v1` | API base (used only to discover seeded ids) |
| `E2E_OUT` | `<tmpdir>/wealthpilot-web-e2e` | Screenshots, the downloaded PDF and `failure.png` |
| `E2E_CHROMIUM` | `/opt/pw-browsers/chromium` | Chromium executable (no `playwright install` needed if one exists) |
| `E2E_HEADED` | unset | `1` shows the browser |

The runner exits non-zero and lists every problem; on an aborted step it saves `failure.png` of the page.
Each new-user run creates another fictional user (`e2e-<id>@example.test`); reset with a fresh database.
