/* Test helpers: a real ApiClient over a mocked fetch, plus a render wrapper with app providers. */
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { createApiClient, type ApiClient } from '@wealthpilot/contracts';
import type { ReactElement } from 'react';

import { TestProviders } from '@/lib/providers';

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

/** Minimal Response stand-in (the jest environment may not provide one). */
function fakeResponse(status: number, body: unknown) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 409 ? 'Conflict' : status === 402 ? 'Payment Required' : 'OK',
    headers: { get: (name: string) => (name.toLowerCase() === 'x-request-id' ? 'req-test' : null) },
    text: async () => text,
  };
}

export function createMockApi(routes: MockRoute[]): { api: ApiClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = jest.fn(async (input: unknown, init?: RequestInit) => {
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
      (r) =>
        (r.method ?? 'GET') === call.method &&
        (typeof r.path === 'string' ? r.path === call.path : r.path.test(call.path)),
    );
    if (!route) {
      return fakeResponse(404, { type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND', detail: `${call.method} ${call.path}` });
    }
    const body = typeof route.body === 'function' ? (route.body as (c: RecordedCall) => unknown)(call) : route.body;
    return fakeResponse(route.status ?? 200, body);
  });
  const api = createApiClient({
    baseUrl: 'http://api.test',
    getToken: () => 'dev:test-user:test@example.com',
    fetch: fetchImpl as unknown as typeof fetch,
    generateIdempotencyKey: () => 'idem-key',
  });
  return { api, calls };
}

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
}

export async function renderWithApi(ui: ReactElement, routes: MockRoute[]) {
  const { api, calls } = createMockApi(routes);
  const client = createTestQueryClient();
  const utils = await render(
    <TestProviders client={client} api={api}>
      {ui}
    </TestProviders>,
  );
  return { ...utils, api, calls, client };
}
