/* Test helpers: a real ApiClient over a mocked fetch, plus a render wrapper with the app providers. */
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createApiClient, type ApiClient } from '@wealthpilot/contracts';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

import { TestProviders } from '@/app/providers';
import { createAppQueryClient, type QueryClientHandlers } from '@/lib/query';

export interface RecordedCall {
  method: string;
  /** Path after /v1, without the query string. */
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

export interface MockRoute {
  method?: string;
  path: string | RegExp;
  status?: number;
  body?: ((call: RecordedCall) => unknown) | object | string | null;
}

function fakeResponse(status: number, body: unknown) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return new Response(status === 204 ? null : text, {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json', 'x-request-id': 'req-test' },
  });
}

export function createMockApi(routes: MockRoute[]): { api: ApiClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: RecordedCall = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace(/^\/v1/, ''),
      query: Object.fromEntries(url.searchParams.entries()),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const route = routes.find(
      (r) => (r.method ?? 'GET') === call.method && (typeof r.path === 'string' ? r.path === call.path : r.path.test(call.path)),
    );
    if (!route) {
      return fakeResponse(404, { type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND', detail: `${call.method} ${call.path}` });
    }
    const body = typeof route.body === 'function' ? (route.body as (c: RecordedCall) => unknown)(call) : route.body;
    return fakeResponse(route.status ?? 200, body);
  });
  const api = createApiClient({
    baseUrl: 'http://api.test/v1',
    getToken: () => 'dev:test-user:test@example.com',
    fetch: fetchImpl as unknown as typeof fetch,
    generateIdempotencyKey: () => 'idem-key',
  });
  return { api, calls };
}

export function createTestQueryClient(handlers?: QueryClientHandlers) {
  const client = createAppQueryClient(handlers);
  client.setDefaultOptions({
    queries: { retry: false, gcTime: Infinity, staleTime: Infinity, refetchOnWindowFocus: false, refetchInterval: false },
    mutations: { retry: false, gcTime: Infinity },
  });
  return client;
}

export function renderWithApi(ui: ReactElement, routes: MockRoute[], opts: { client?: QueryClient } = {}) {
  const { api, calls } = createMockApi(routes);
  const client = opts.client ?? createTestQueryClient();
  const utils = render(
    <TestProviders client={client} api={api}>
      {ui}
    </TestProviders>,
  );
  return { ...utils, api, calls, client };
}
