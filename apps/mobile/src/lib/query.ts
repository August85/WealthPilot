import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { MutationCache, QueryCache, QueryClient, type Query } from '@tanstack/react-query';
import { ApiError, isApiError, isNetworkError } from '@wealthpilot/contracts';

/** Query keys in one place so invalidation is consistent. */
export const qk = {
  me: ['me'] as const,
  taxResidency: ['me', 'tax-residency'] as const,
  securityEvents: ['me', 'security-events'] as const,
  household: (id: string) => ['household', id] as const,
  accounts: (includeArchived = false) => ['accounts', { includeArchived }] as const,
  accountsAll: ['accounts'] as const,
  account: (id: string) => ['account', id] as const,
  valuations: (id: string) => ['account', id, 'valuations'] as const,
  netWorth: (currency: string) => ['net-worth', currency] as const,
  netWorthAll: ['net-worth'] as const,
  netWorthHistory: (currency: string, months: number) => ['net-worth-history', currency, months] as const,
  insights: (currency: string) => ['insights', currency] as const,
  fxRate: (base: string, quote: string) => ['fx', 'user', base, quote] as const,
  fxReference: (base: string, quote: string) => ['fx', 'reference', base, quote] as const,
  price: (symbol: string) => ['price', symbol] as const,
  grants: ['rsu', 'grants'] as const,
  grant: (id: string) => ['rsu', 'grant', id] as const,
  calendar: (from?: string, to?: string) => ['rsu', 'calendar', from ?? '', to ?? ''] as const,
  goals: ['goals'] as const,
  goal: (id: string) => ['goal', id] as const,
  scenarios: (includeArchived = false) => ['scenarios', { includeArchived }] as const,
  scenariosAll: ['scenarios'] as const,
  scenario: (id: string) => ['scenario', id] as const,
  scenarioVersions: (id: string) => ['scenario', id, 'versions'] as const,
  scenarioDefaults: (preset: string, kind: string) => ['scenario-defaults', preset, kind] as const,
  run: (id: string) => ['run', id] as const,
  runResult: (id: string) => ['run', id, 'result'] as const,
  comparison: (ids: string[]) => ['comparison', [...ids].sort().join(',')] as const,
  exportJob: (id: string) => ['export', id] as const,
  notificationPrefs: ['notification-preferences'] as const,
  inbox: ['notifications'] as const,
};

/** Queries that are safe and useful to keep for offline, read-only viewing. */
const PERSISTED_ROOTS = new Set([
  'me',
  'accounts',
  'account',
  'net-worth',
  'net-worth-history',
  'insights',
  'goals',
  'rsu',
  'scenarios',
  'scenario',
  'run',
  'fx',
]);

export function shouldPersistQuery(query: Query): boolean {
  const root = query.queryKey[0];
  return typeof root === 'string' && PERSISTED_ROOTS.has(root) && query.state.status === 'success';
}

export interface QueryClientHandlers {
  onPlanLimit?: (err: ApiError) => void;
  onUnauthorized?: (err: ApiError) => void;
  onVersionConflict?: (err: ApiError, meta: Record<string, unknown> | undefined) => void;
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status < 500) return false;
  if (isNetworkError(error)) return failureCount < 1;
  return failureCount < 2;
}

export function createAppQueryClient(handlers: QueryClientHandlers = {}): QueryClient {
  const route = (error: unknown, meta?: Record<string, unknown>) => {
    if (!isApiError(error)) return;
    if (error.isPlanLimit) handlers.onPlanLimit?.(error);
    else if (error.isUnauthorized) handlers.onUnauthorized?.(error);
    else if (error.isVersionConflict && !meta?.handlesConflict) handlers.onVersionConflict?.(error, meta);
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: (e) => route(e) }),
    mutationCache: new MutationCache({ onError: (e, _v, _c, m) => route(e, m.meta) }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 24 * 60 * 60 * 1000,
        retry: shouldRetry,
        // Offline: serve cached data, do not fail.
        networkMode: 'offlineFirst',
      },
      mutations: {
        retry: false,
        // Mutations are disabled offline (read-only cache); never queue writes for later replay.
        networkMode: 'always',
      },
    },
  });
}

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'wp.query-cache.v1',
  throttleTime: 2000,
});

/** Bump to discard persisted caches after incompatible changes. */
export const PERSIST_BUSTER = 'contract-v1';
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;
