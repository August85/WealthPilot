import { describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  NetworkError,
  buildQuery,
  createApiClient,
  generateUuidV4,
  normalizeBaseUrl,
  type Account,
  type NetWorth,
} from '../src';

type Call = { url: string; init: RequestInit };

function mockFetch(responder: (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const r = responder(call);
    const status = r.status ?? 200;
    const text = r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(status === 204 ? null : text, {
      status,
      statusText: status === 409 ? 'Conflict' : 'OK',
      headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'req-123', ...(r.headers ?? {}) },
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

describe('createApiClient', () => {
  it('sends the bearer token and hits /v1 paths', async () => {
    const { fn, calls } = mockFetch(() => ({ body: { items: [] } }));
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: async () => 'tok', fetch: fn });
    await api.accounts.list({ kind: 'asset', include_archived: false });
    expect(calls[0]!.url).toBe('https://api.test/v1/accounts?kind=asset&include_archived=false');
    expect(header(calls[0]!.init, 'Authorization')).toBe('Bearer tok');
    expect(calls[0]!.init.method).toBe('GET');
    expect(header(calls[0]!.init, 'Idempotency-Key')).toBeUndefined();
  });

  it('supports dev tokens and omits Authorization when no token', async () => {
    const { fn, calls } = mockFetch(() => ({ body: { status: 'ok' } }));
    const api = createApiClient({ baseUrl: 'http://x/v1/', getToken: () => 'dev:u1:a@b.com', fetch: fn });
    await api.me.get();
    expect(header(calls[0]!.init, 'Authorization')).toBe('Bearer dev:u1:a@b.com');

    const anon = createApiClient({ baseUrl: 'http://x', getToken: () => null, fetch: fn });
    await anon.me.get();
    expect(header(calls[1]!.init, 'Authorization')).toBeUndefined();
    await anon.health.healthz();
    expect(calls[2]!.url).toBe('http://x/v1/healthz');
  });

  it('adds an Idempotency-Key to every POST, overridable for retries', async () => {
    const { fn, calls } = mockFetch(() => ({ status: 201, body: {} }));
    let n = 0;
    const api = createApiClient({
      baseUrl: 'http://x',
      getToken: () => 't',
      fetch: fn,
      generateIdempotencyKey: () => `key-${++n}`,
    });
    await api.accounts.addValuation('a1', { amount: '10.00', as_of: '2026-10-01', verification_status: 'verified' });
    await api.accounts.addValuation(
      'a1',
      { amount: '10.00', as_of: '2026-10-01', verification_status: 'verified' },
      { idempotencyKey: 'retry-key' },
    );
    expect(header(calls[0]!.init, 'Idempotency-Key')).toBe('key-1');
    expect(header(calls[1]!.init, 'Idempotency-Key')).toBe('retry-key');
    expect(calls[0]!.url).toBe('http://x/v1/accounts/a1/valuations');
    expect(header(calls[0]!.init, 'Content-Type')).toBe('application/json');
  });

  it('keeps decimal strings as strings in both directions', async () => {
    const nw: Partial<NetWorth> = { net_worth: '12345678901234567.89', gross_assets: '0.10' };
    const { fn, calls } = mockFetch(() => ({ body: nw }));
    const api = createApiClient({ baseUrl: 'http://x', getToken: () => 't', fetch: fn });
    const res = await api.netWorth.get({ currency: 'USD' });
    expect(res.net_worth).toBe('12345678901234567.89');
    expect(typeof res.gross_assets).toBe('string');

    await api.fx.saveRate({ base: 'USD', quote: 'INR', rate: '85.000000001', as_of: '2026-10-01' });
    expect(calls[1]!.init.body).toBe('{"base":"USD","quote":"INR","rate":"85.000000001","as_of":"2026-10-01"}');
  });

  it('throws ApiError with the RFC 7807 code on errors', async () => {
    const { fn } = mockFetch(() => ({
      status: 409,
      body: {
        type: 'https://wealthpilot.app/problems/version-conflict',
        title: 'Version conflict',
        status: 409,
        detail: 'Account was modified',
        code: 'VERSION_CONFLICT',
        request_id: 'req-abc',
      },
    }));
    const api = createApiClient({ baseUrl: 'http://x', getToken: () => 't', fetch: fn });
    const err = await api.accounts.update('a1', { name: 'X', version: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.code).toBe('VERSION_CONFLICT');
    expect(apiErr.status).toBe(409);
    expect(apiErr.isVersionConflict).toBe(true);
    expect(apiErr.requestId).toBe('req-abc');
    expect(apiErr.message).toBe('Account was modified');
  });

  it('recognises PLAN_LIMIT and validation errors', async () => {
    const { fn } = mockFetch((c) =>
      c.url.endsWith('/accounts')
        ? { status: 402, body: { type: 'about:blank', title: 'Plan limit', status: 402, code: 'PLAN_LIMIT', detail: 'accounts' } }
        : { status: 422, body: { type: 'about:blank', title: 'Invalid', status: 422, errors: [{ loc: ['body', 'amount'], msg: 'bad' }] } },
    );
    const api = createApiClient({ baseUrl: 'http://x', getToken: () => 't', fetch: fn });
    const e1 = (await api.accounts.create({ kind: 'asset', type: 'cash', name: 'c', country: 'US', currency: 'USD' }).catch((e) => e)) as ApiError;
    expect(e1.isPlanLimit).toBe(true);
    expect(e1.detail).toBe('accounts');
    const e2 = (await api.goals.create({
      type: 'custom', name: 'g', target_date: '2030-01-01', target_amount: '1', currency: 'USD', priority: 1,
    }).catch((e) => e)) as ApiError;
    expect(e2.isValidation).toBe(true);
    expect(e2.fieldErrors[0]!.loc).toEqual(['body', 'amount']);
    expect(e2.requestId).toBe('req-123');
  });

  it('normalizes non-problem error bodies', async () => {
    const { fn } = mockFetch(() => ({ status: 500, body: 'oops' }));
    const api = createApiClient({ baseUrl: 'http://x', getToken: () => 't', fetch: fn });
    const err = (await api.me.get().catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.code).toBeNull();
  });

  it('wraps transport failures in NetworkError', async () => {
    const fn = vi.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const api = createApiClient({ baseUrl: 'http://x', getToken: () => 't', fetch: fn });
    await expect(api.me.get()).rejects.toBeInstanceOf(NetworkError);
  });

  it('handles 204 and DELETE', async () => {
    const { fn, calls } = mockFetch(() => ({ status: 204 }));
    const api = createApiClient({ baseUrl: 'http://x', getToken: () => 't', fetch: fn });
    await expect(api.accounts.remove('a b')).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe('http://x/v1/accounts/a%20b');
    expect(calls[0]!.init.method).toBe('DELETE');
  });

  it('covers every endpoint path and method', async () => {
    const { fn, calls } = mockFetch(() => ({ body: {} }));
    const api = createApiClient({ baseUrl: 'http://x', getToken: () => 't', fetch: fn });
    const acc = { kind: 'asset', type: 'cash', name: 'c', country: 'US', currency: 'USD' } as const;
    const cases: [() => Promise<unknown>, string, string][] = [
      [() => api.me.update({ reporting_currency: 'INR' }), 'PATCH', '/v1/me'],
      [() => api.me.onboard({ home_country: 'US', reporting_currency: 'USD', household_name: 'H', disclaimer_accepted: true, tax_residency: [] }), 'POST', '/v1/me/onboarding'],
      [() => api.me.getTaxResidency(), 'GET', '/v1/me/tax-residency'],
      [() => api.me.replaceTaxResidency([]), 'PUT', '/v1/me/tax-residency'],
      [() => api.me.securityEvents({ limit: 10, cursor: 'c1' }), 'GET', '/v1/me/security-events?limit=10&cursor=c1'],
      [() => api.privacy.requestDeletion({ confirm: 'DELETE' }), 'POST', '/v1/privacy/delete-request'],
      [() => api.households.get('h1'), 'GET', '/v1/households/h1'],
      [() => api.households.update('h1', { display_name: 'H' }), 'PATCH', '/v1/households/h1'],
      [() => api.accounts.create(acc), 'POST', '/v1/accounts'],
      [() => api.accounts.get('a1'), 'GET', '/v1/accounts/a1'],
      [() => api.accounts.listValuations('a1'), 'GET', '/v1/accounts/a1/valuations'],
      [() => api.fx.getRate({ base: 'USD', quote: 'INR' }), 'GET', '/v1/fx/rates?base=USD&quote=INR'],
      [() => api.fx.getReference({ base: 'USD', quote: 'INR' }), 'GET', '/v1/fx/reference?base=USD&quote=INR'],
      [() => api.prices.get('GOOG'), 'GET', '/v1/prices?symbol=GOOG'],
      [() => api.prices.save({ symbol: 'GOOG', price: '1', currency: 'USD', as_of: '2026-10-01' }), 'POST', '/v1/prices'],
      [() => api.rsu.listGrants(), 'GET', '/v1/rsu/grants'],
      [() => api.rsu.getGrant('g1'), 'GET', '/v1/rsu/grants/g1'],
      [() => api.rsu.createGrant({ employer_name: 'A', symbol: 'A', grant_date: '2026-01-01', granted_shares: '4', award_currency: 'USD' }), 'POST', '/v1/rsu/grants'],
      [() => api.rsu.updateGrant('g1', { version: 1 }), 'PATCH', '/v1/rsu/grants/g1'],
      [() => api.rsu.deleteGrant('g1'), 'DELETE', '/v1/rsu/grants/g1'],
      [() => api.rsu.addVest('g1', { vest_date: '2026-01-01', scheduled_shares: '1' }), 'POST', '/v1/rsu/grants/g1/vests'],
      [() => api.rsu.updateVest('v1', { status: 'vested', vested_shares: '1', vest_fmv: '1', withheld_shares: '0' }), 'PATCH', '/v1/rsu/vests/v1'],
      [() => api.rsu.deleteVest('v1'), 'DELETE', '/v1/rsu/vests/v1'],
      [() => api.rsu.addDisposition('v1', { date: '2026-01-01', kind: 'sale', shares: '1', price: '1' }), 'POST', '/v1/rsu/vests/v1/dispositions'],
      [() => api.rsu.calendar({ from: '2026-01-01', to: '2026-12-31' }), 'GET', '/v1/rsu/calendar?from=2026-01-01&to=2026-12-31'],
      [() => api.netWorth.get({ currency: 'INR', as_of: '2026-10-10' }), 'GET', '/v1/net-worth?currency=INR&as_of=2026-10-10'],
      [() => api.netWorth.history({ currency: 'USD', months: 12 }), 'GET', '/v1/net-worth/history?currency=USD&months=12'],
      [() => api.insights.list({ currency: 'USD' }), 'GET', '/v1/insights?currency=USD'],
      [() => api.goals.list(), 'GET', '/v1/goals'],
      [() => api.goals.get('g1'), 'GET', '/v1/goals/g1'],
      [() => api.goals.update('g1', { name: 'n', version: 2 }), 'PATCH', '/v1/goals/g1'],
      [() => api.goals.remove('g1'), 'DELETE', '/v1/goals/g1'],
      [() => api.scenarios.list({ include_archived: true }), 'GET', '/v1/scenarios?include_archived=true'],
      [() => api.scenarios.create({ name: 's', kind: 'home', preset: 'baseline' }), 'POST', '/v1/scenarios'],
      [() => api.scenarios.get('s1'), 'GET', '/v1/scenarios/s1'],
      [() => api.scenarios.update('s1', { archived: true }), 'PATCH', '/v1/scenarios/s1'],
      [() => api.scenarios.clone('s1', { name: 'copy' }), 'POST', '/v1/scenarios/s1/clone'],
      [() => api.scenarios.defaults({ preset: 'conservative', kind: 'home' }), 'GET', '/v1/scenarios/defaults?preset=conservative&kind=home'],
      [() => api.scenarios.listVersions('s1'), 'GET', '/v1/scenarios/s1/versions'],
      [() => api.runs.create('ver1'), 'POST', '/v1/scenario-versions/ver1/runs'],
      [() => api.runs.get('r1'), 'GET', '/v1/runs/r1'],
      [() => api.runs.results('r1'), 'GET', '/v1/runs/r1/results'],
      [() => api.comparisons.create({ run_ids: ['r1', 'r2'] }), 'POST', '/v1/comparisons'],
      [() => api.exports.create({ format: 'csv', scope: 'balances' }), 'POST', '/v1/exports'],
      [() => api.exports.get('e1'), 'GET', '/v1/exports/e1'],
      [() => api.notifications.getPreferences(), 'GET', '/v1/notification-preferences'],
      [() => api.notifications.updatePreferences({ items: [] }), 'PATCH', '/v1/notification-preferences'],
      [() => api.notifications.registerDevice({ expo_push_token: 'ExponentPushToken[x]', platform: 'ios' }), 'POST', '/v1/devices'],
      [() => api.notifications.unregisterDevice('ExponentPushToken[x]'), 'DELETE', '/v1/devices/ExponentPushToken%5Bx%5D'],
      [() => api.notifications.inbox(), 'GET', '/v1/notifications'],
      [() => api.notifications.markRead('n1'), 'POST', '/v1/notifications/n1/read'],
      [() => api.health.readyz(), 'GET', '/v1/readyz'],
    ];
    for (const [fnCall, method, path] of cases) {
      const before = calls.length;
      await fnCall();
      const c = calls[before]!;
      expect({ method: c.init.method, url: c.url }).toEqual({ method, url: `http://x${path}` });
      if (method === 'POST') expect(header(c.init, 'Idempotency-Key')).toMatch(/[0-9a-f-]{36}/);
    }
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith('/runs'))!.init.body))).toEqual({ seed: null });
  });

  it('resolves export download URLs', () => {
    const api = createApiClient({ baseUrl: 'https://api.test/v1', getToken: () => 't', fetch: vi.fn() as unknown as typeof fetch });
    expect(api.exports.resolveDownloadUrl({ download_url: null })).toBeNull();
    expect(api.exports.resolveDownloadUrl({ download_url: '/v1/exports/e1/download?token=a' })).toBe(
      'https://api.test/v1/exports/e1/download?token=a',
    );
    expect(api.exports.resolveDownloadUrl({ download_url: 'https://cdn.test/x?sig=1' })).toBe('https://cdn.test/x?sig=1');
  });

  it('returns typed Account objects untouched', async () => {
    const account = { id: 'a1', ownership_pct: '50', latest_valuation: { amount: '850000.00' } } as unknown as Account;
    const { fn } = mockFetch(() => ({ body: account }));
    const api = createApiClient({ baseUrl: 'http://x', getToken: () => 't', fetch: fn });
    expect(await api.accounts.get('a1')).toEqual(account);
  });
});

describe('helpers', () => {
  it('normalizeBaseUrl', () => {
    expect(normalizeBaseUrl('http://a')).toBe('http://a/v1');
    expect(normalizeBaseUrl('http://a/v1/')).toBe('http://a/v1');
  });
  it('buildQuery skips empty values', () => {
    expect(buildQuery({ a: 1, b: undefined, c: null, d: '', e: false })).toBe('?a=1&e=false');
    expect(buildQuery()).toBe('');
  });
  it('generateUuidV4 is RFC 4122 v4', () => {
    const id = generateUuidV4();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(generateUuidV4()).not.toBe(id);
  });
});
