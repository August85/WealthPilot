// End-to-end check of the web app against the real API (not part of CI; see e2e/README.md).
//
//   node e2e/run.mjs [--only sweep|new-user|screens]
//
// Environment:
//   E2E_WEB_URL    web app origin            (default http://localhost:3000)
//   E2E_API_URL    API base URL incl. /v1    (default http://localhost:8000/v1)
//   E2E_OUT        screenshots/downloads dir (default <os tmpdir>/wealthpilot-web-e2e; keep it outside the repo)
//   E2E_CHROMIUM   Chromium executable       (default /opt/pw-browsers/chromium)
//   E2E_HEADED=1   show the browser
import { mkdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';

const WEB = (process.env.E2E_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.E2E_API_URL ?? 'http://localhost:8000/v1').replace(/\/$/, '');
const OUT = process.env.E2E_OUT ?? path.join(os.tmpdir(), 'wealthpilot-web-e2e');
const CHROME = process.env.E2E_CHROMIUM ?? '/opt/pw-browsers/chromium';
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const DEMO = { subject: 'demo', email: 'demo@example.test' };
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

mkdirSync(OUT, { recursive: true });

const failures = [];
let lastPage = null;
const log = (...a) => console.log(...a);

function fail(msg) {
  failures.push(msg);
  console.error(`  FAIL ${msg}`);
}

/** API helper for discovering ids (the browser itself only talks to the API through the app). */
async function api(pathname, subject = DEMO.subject, email = DEMO.email) {
  const res = await fetch(`${API}${pathname}`, { headers: { Authorization: `Bearer dev:${subject}:${email}` } });
  if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status}`);
  return res.json();
}

/**
 * Collects console errors, page errors and HTTP 4xx/5xx for the current step. `allow` lists expected failures
 * (url regex + status) that the UI handles gracefully.
 */
function monitor(page) {
  const state = { step: 'start', issues: [], allow: [] };
  const allowed = (url, status) => state.allow.some((a) => a.url.test(url) && (a.status === undefined || a.status === status));
  page.on('response', (r) => {
    const status = r.status();
    if (status >= 400 && !allowed(r.url(), status)) state.issues.push(`[${state.step}] HTTP ${status} ${r.request().method()} ${r.url()}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // The browser logs every failed fetch as a console error; allowed responses are not issues.
    const loc = m.location()?.url ?? '';
    if (/Failed to load resource/.test(text) && state.allow.some((a) => a.url.test(loc))) return;
    state.issues.push(`[${state.step}] console: ${text.slice(0, 300)}`);
  });
  page.on('pageerror', (e) => state.issues.push(`[${state.step}] pageerror: ${String(e).slice(0, 300)}`));
  return state;
}

/** Horizontal page overflow in px, plus the deepest elements that stick out past the viewport (for diagnosis). */
async function overflowOf(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const px = document.documentElement.scrollWidth - vw;
    if (px <= 1) return { px, culprits: '' };
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0 && ![...el.children].some((c) => c.getBoundingClientRect().right > vw + 1)) {
        out.push(`${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}.${String(el.className).slice(0, 60)}`);
        if (out.length >= 3) break;
      }
    }
    return { px, culprits: out.join(' | ') };
  });
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  // Wait until no loading placeholders remain (QueryView shows role=status while loading).
  await page
    .waitForFunction(() => !document.querySelector('[data-testid="loading-state"], [aria-busy="true"]'), null, { timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(250);
}

async function signIn(page, subject, email) {
  await page.goto(`${WEB}/sign-in`);
  await page.getByTestId('dev-sign-in-screen').waitFor();
  await page.getByTestId('field-subject').fill(subject);
  await page.getByTestId('field-email').fill(email);
  await page.getByTestId('dev-sign-in-submit').click();
  await page.waitForURL(/\/(overview|onboarding)/, { timeout: 20_000 });
}

async function newPage(browser, viewport = VIEWPORTS.desktop) {
  const context = await browser.newContext({ viewport, acceptDownloads: true, colorScheme: 'light' });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  lastPage = page;
  return { context, page };
}

async function checkPage(page, mon, url, label) {
  mon.step = label;
  const before = mon.issues.length;
  await page.goto(`${WEB}${url}`);
  await settle(page);
  if (await page.getByTestId('error-state').count()) fail(`${label}: error state shown (${url})`);
  if (!(await page.locator('h1').count())) fail(`${label}: no page heading (${url})`);
  const overflow = await overflowOf(page);
  if (overflow.px > 1) fail(`${label}: horizontal page scroll of ${overflow.px}px (${url}) ${overflow.culprits}`);
  const added = mon.issues.slice(before);
  log(`  ${added.length ? 'WARN' : 'ok  '} ${label.padEnd(22)} ${url}`);
}

async function demoIds() {
  const [accounts, grants, goals, scenarios] = await Promise.all([
    api('/accounts'),
    api('/rsu/grants'),
    api('/goals'),
    api('/scenarios'),
  ]);
  const scen = scenarios.items;
  const runs = scen.map((s) => s.latest_run).filter((r) => r && r.status === 'completed');
  const home = scen.find((s) => s.kind === 'home' && s.latest_run) ?? scen[0];
  return {
    account: accounts.items[0]?.id,
    epf: accounts.items.find((a) => a.type === 'epf')?.id,
    grant: grants.items[0]?.id,
    goal: goals.items[0]?.id,
    homeScenario: home?.id,
    homeRun: home?.latest_run?.id,
    runs: runs.map((r) => r.id),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Demo sweep: every page renders for the seeded user with no console errors, page errors or HTTP 4xx/5xx.
// ---------------------------------------------------------------------------------------------------------------
async function sweep(browser) {
  log('\nDemo sweep (seeded user "demo")');
  const ids = await demoIds();
  const { context, page } = await newPage(browser);
  const mon = monitor(page);
  // The public reference-rate endpoint depends on an upstream provider; when it is unavailable the API answers
  // 503 and the FX page says so ("reference-unavailable"). That is the only allowed failure.
  mon.allow.push({ url: /\/v1\/fx\/reference/, status: 503 });
  await page.goto(`${WEB}/`);
  await settle(page);
  await signIn(page, DEMO.subject, DEMO.email);
  const pages = [
    ['/overview', 'Overview'],
    ['/accounts', 'Accounts'],
    ['/accounts/new', 'Add account'],
    ids.account && [`/accounts/${ids.account}`, 'Account detail'],
    ids.epf && [`/accounts/${ids.epf}/epf`, 'EPF editor'],
    ['/rsu', 'RSU grants'],
    ['/rsu/new', 'New grant'],
    ids.grant && [`/rsu/${ids.grant}`, 'Grant editor'],
    ['/rsu/calendar', 'Vest calendar'],
    ['/fx', 'FX'],
    ['/goals', 'Goals'],
    ['/goals/new', 'New goal'],
    ids.goal && [`/goals/${ids.goal}`, 'Edit goal'],
    ['/scenarios', 'Scenarios'],
    ['/scenarios/new', 'New scenario'],
    ids.homeScenario && [`/scenarios/${ids.homeScenario}`, 'Scenario editor'],
    ids.homeRun && [`/runs/${ids.homeRun}?scenario=${ids.homeScenario}`, 'Run results'],
    ids.homeRun && [`/runs/${ids.homeRun}/explain?metric=net_worth_at_retirement&scenario=${ids.homeScenario}`, 'Explain'],
    ids.runs.length >= 2 && [`/scenarios/compare?runs=${ids.runs.slice(0, 3).join(',')}`, 'Compare'],
    ['/plan/home', 'Home planner'],
    ['/plan/retirement', 'Retirement planner'],
    ['/insights', 'Insights'],
    ['/notifications', 'Notifications'],
    ['/export', 'Export'],
    ['/settings', 'Settings'],
    ['/settings/residency', 'Residency'],
    ['/settings/security', 'Security'],
    ['/subscription', 'Subscription'],
    ['/help', 'Help'],
    ['/does-not-exist', 'Not found'],
  ].filter(Boolean);
  for (const [url, label] of pages) {
    if (label === 'Not found') {
      mon.allow.push({ url: /\/does-not-exist$/, status: 404 });
      mon.step = label;
      await page.goto(`${WEB}${url}`);
      await settle(page);
      if (!(await page.getByText(/not found|couldn.t find/i).count())) fail('Not found page missing');
      log(`  ok   ${label.padEnd(22)} ${url}`);
      continue;
    }
    await checkPage(page, mon, url, label);
  }
  // Same pages at phone width: no horizontal page scroll anywhere.
  await page.setViewportSize(VIEWPORTS.mobile);
  for (const [url, label] of pages) {
    if (label === 'Not found') continue;
    await checkPage(page, mon, url, `${label} @390`);
  }
  // Mobile navigation drawer.
  await page.setViewportSize(VIEWPORTS.mobile);
  mon.step = 'Mobile nav';
  await page.goto(`${WEB}/overview`);
  await settle(page);
  await page.getByTestId('nav-open').click();
  await page.getByRole('dialog').getByTestId('nav-accounts').click();
  await page.waitForURL(/\/accounts$/);
  await settle(page);
  log('  ok   Mobile nav drawer');
  for (const i of mon.issues) fail(i);
  await context.close();
  return ids;
}

// ---------------------------------------------------------------------------------------------------------------
// 2. New user: sign in -> onboarding -> FX 85 -> INR FD -> home scenario -> run -> results -> PDF export.
// ---------------------------------------------------------------------------------------------------------------
async function newUser(browser) {
  const subject = `e2e-${Date.now().toString(36)}`;
  const email = `${subject}@example.test`;
  log(`\nNew-user flow (${subject})`);
  const { context, page } = await newPage(browser);
  const mon = monitor(page);
  mon.allow.push({ url: /\/v1\/fx\/reference/, status: 503 });
  // A brand-new user has no saved USD/INR rate: GET /fx/rates answers 404 FX_RATE_MISSING and the UI shows
  // "fx-missing" with a prompt to add one. Allowed only until the rate is saved below.
  const fxMissing = { url: /\/v1\/fx\/rates/, status: 404 };
  mon.allow.push(fxMissing);

  mon.step = 'sign-in';
  await signIn(page, subject, email);
  await page.waitForURL(/\/onboarding/);
  log('  ok   dev sign-in as a new subject -> onboarding');

  mon.step = 'onboarding';
  await page.getByTestId('field-tax_residency.0.from_date').fill('2020-01-01');
  await page.getByTestId('disclaimer-switch').click();
  await page.getByTestId('residency-continue').click();
  await page.getByTestId('field-household_name').fill('E2E household');
  await page.getByTestId('household-finish').click();
  await page.waitForURL(/\/overview/);
  await settle(page);
  log('  ok   onboarding completed');

  mon.step = 'fx';
  await page.goto(`${WEB}/fx`);
  await settle(page);
  await page.getByTestId('fx-missing').waitFor();
  await page.getByTestId('field-rate').fill('85');
  await page.getByTestId('save-fx').click();
  await page.getByTestId('user-rate').getByText(/85/).first().waitFor();
  mon.allow.splice(mon.allow.indexOf(fxMissing), 1);
  log('  ok   saved FX rate 85');

  mon.step = 'add-fd';
  await page.goto(`${WEB}/accounts/new`);
  await settle(page);
  await page.getByTestId('template-fixed_deposit').click();
  await page.getByTestId('field-name').fill('E2E SBI FD');
  await page.getByTestId('field-details.principal').fill('8,00,000');
  await page.getByTestId('field-details.start_date').fill('2025-10-01');
  await page.getByTestId('field-details.maturity_date').fill('2027-10-01');
  await page.getByTestId('field-details.interest_rate_annual').fill('7.1');
  await page.getByTestId('field-amount').fill('8,50,000.50');
  await page.getByTestId('field-as_of').fill('2026-10-01');
  await page.getByTestId('choice-verification_status-verified').click();
  await page.getByTestId('save-account').click();
  await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/);
  await settle(page);
  await page.getByText('₹8,50,000.50').first().waitFor();
  log('  ok   added INR fixed deposit (₹8,50,000.50)');

  mon.step = 'overview';
  await page.goto(`${WEB}/overview`);
  await settle(page);
  // 850,000.50 INR at 85 INR/USD = $10,000.01 (rounded half-up from 10000.0058...).
  await page.getByTestId('net-worth').getByText('$10,000.01').waitFor();
  log('  ok   overview converts with the saved rate ($10,000.01)');

  mon.step = 'scenario';
  await page.goto(`${WEB}/scenarios/new?kind=home`);
  await settle(page);
  await page.getByTestId('field-name').fill('E2E home purchase');
  await page.getByTestId('create-scenario').click();
  await page.waitForURL(/\/scenarios\/[0-9a-f-]{36}$/);
  await settle(page);
  const scenarioUrl = page.url();
  await page.getByTestId('field-values.income.salary_annual').fill('180000');
  await page.getByTestId('field-values.income.living_expenses_monthly').fill('5500');
  // A new household has no home defaults (the server sends home: null), so switch the section on and enter
  // the purchase inputs that are always the user's own.
  await page.getByTestId('assumption-toggle-home').click();
  await page.getByTestId('enable-home').click();
  await page.getByTestId('field-values.home.target_price').fill('900000');
  await page.getByTestId('field-values.home.purchase_date').fill('2029-06-01');
  await page.getByTestId('field-values.home.down_payment_pct').fill('20');
  await page.getByTestId('field-values.home.mortgage_rate_annual').fill('6.5');
  await page.getByTestId('field-values.home.property_tax_rate_annual').fill('1.2');
  await page.getByTestId('save-version').click();
  await page.getByTestId('version-history').getByText('Version 2').first().waitFor();
  log('  ok   created home scenario and saved version 2 (salary, expenses, home inputs)');

  mon.step = 'run';
  await page.getByTestId('save-and-run').click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}/);
  await page.getByTestId('run-result').waitFor();
  await page.getByTestId('metrics-card').waitFor({ timeout: 60_000 });
  await settle(page);
  const runUrl = page.url();
  await page.getByTestId('home-monthly').waitFor();
  for (const label of ['As of', 'Scenario:', 'Assumptions:', 'Illustrative']) {
    if (!(await page.getByTestId('metrics-card').getByText(label, { exact: false }).count())) fail(`run results: forecast label "${label}" missing`);
  }
  log('  ok   run completed; results show forecast labels');

  mon.step = 'export';
  await page.getByTestId('export-pdf').click();
  await page.waitForURL(/\/export\?run=/);
  await settle(page);
  await page.getByTestId('create-export').click();
  await page.getByTestId('download-export').waitFor({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-export').click()]);
  const file = path.join(OUT, `new-user-${download.suggestedFilename()}`);
  await download.saveAs(file);
  const size = statSync(file).size;
  if (!download.suggestedFilename().endsWith('.pdf') || size < 1000) fail(`export: unexpected download ${download.suggestedFilename()} (${size} bytes)`);
  log(`  ok   exported PDF and downloaded ${path.basename(file)} (${size} bytes)`);

  for (const i of mon.issues) fail(i);
  await context.close();
  return { scenarioUrl, runUrl };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Screenshots of key screens at desktop and phone sizes (saved to E2E_OUT for review).
// ---------------------------------------------------------------------------------------------------------------
async function screens(browser, ids) {
  log(`\nScreenshots -> ${OUT}`);
  const shots = [
    ['overview', '/overview'],
    ['accounts', '/accounts'],
    ['scenario-editor', `/scenarios/${ids.homeScenario}`],
    ['run-results', `/runs/${ids.homeRun}?scenario=${ids.homeScenario}`],
    ['compare', `/scenarios/compare?runs=${ids.runs.slice(0, 3).join(',')}`],
  ];
  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    const { context, page } = await newPage(browser, viewport);
    const mon = monitor(page);
    mon.allow.push({ url: /\/v1\/fx\/reference/, status: 503 });
    await signIn(page, DEMO.subject, DEMO.email);
    for (const [name, url] of shots) {
      mon.step = `${name}@${vpName}`;
      await page.goto(`${WEB}${url}`);
      await settle(page);
      await page.waitForTimeout(600); // chart animations
      const overflow = await overflowOf(page);
      if (overflow.px > 1) fail(`${name}@${vpName}: horizontal page scroll of ${overflow.px}px ${overflow.culprits}`);
      const file = path.join(OUT, `${name}-${vpName}.png`);
      await page.screenshot({ path: file, fullPage: true });
      log(`  saved ${file}`);
    }
    for (const i of mon.issues) fail(i);
    await context.close();
  }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: process.env.E2E_HEADED !== '1' });
try {
  const ids = !ONLY || ONLY === 'sweep' || ONLY === 'screens' ? (ONLY === 'screens' ? await demoIds() : await sweep(browser)) : null;
  if (!ONLY || ONLY === 'new-user') await newUser(browser);
  if (ids && (!ONLY || ONLY === 'screens')) await screens(browser, ids);
} catch (e) {
  fail(`aborted: ${e instanceof Error ? e.stack : String(e)}`);
  if (lastPage && !lastPage.isClosed()) {
    const file = path.join(OUT, 'failure.png');
    await lastPage.screenshot({ path: file, fullPage: true }).catch(() => {});
    console.error(`  failure screenshot: ${file} (at ${lastPage.url()})`);
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
log('\nAll e2e checks passed.');
