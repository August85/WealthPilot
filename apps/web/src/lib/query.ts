import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError, isApiError, isNetworkError } from '@wealthpilot/contracts';

/** Query keys in one place so invalidation is consistent (same keys as the mobile app). */
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
  insightsAll: ['insights'] as const,
  fxRate: (base: string, quote: string) => ['fx', 'user', base, quote] as const,
  fxReference: (base: string, quote: string) => ['fx-reference', base, quote] as const,
  fxAll: ['fx'] as const,
  price: (symbol: string) => ['price', symbol] as const,
  grants: ['rsu', 'grants'] as const,
  grant: (id: string) => ['rsu', 'grant', id] as const,
  rsuAll: ['rsu'] as const,
  calendar: (from?: string, to?: string) => ['rsu', 'calendar', from ?? '', to ?? ''] as const,
  goals: ['goals'] as const,
  goal: (id: string) => ['goal', id] as const,
  goalAll: ['goal'] as const,
  scenarios: (includeArchived = false) => ['scenarios', { includeArchived }] as const,
  scenariosAll: ['scenarios'] as const,
  scenario: (id: string) => ['scenario', id] as const,
  scenarioAll: ['scenario'] as const,
  scenarioVersions: (id: string) => ['scenario', id, 'versions'] as const,
  scenarioDefaults: (preset: string, kind: string) => ['scenario-defaults', preset, kind] as const,
  run: (id: string) => ['run', id] as const,
  runResult: (id: string) => ['run', id, 'result'] as const,
  comparison: (ids: string[]) => ['comparison', [...ids].sort().join(',')] as const,
  exportJob: (id: string) => ['export', id] as const,
  notificationPrefs: ['notification-preferences'] as const,
  inbox: ['notifications'] as const,
};

/** Everything a financial write can change in the household view. */
export const HOUSEHOLD_KEYS = [qk.accountsAll, qk.netWorthAll, ['net-worth-history'], qk.insightsAll, qk.goals, qk.goalAll];

/** Live data (overview, accounts, notifications) refetches this often while the tab is visible. */
export const LIVE_REFETCH_MS = 30_000;

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

/**
 * The app QueryClient. Data is kept in memory only (never persisted to browser storage). Queries refetch on
 * window focus and reconnect so edits made on the phone show up when you return to the tab.
 */
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
        staleTime: 15_000,
        gcTime: 10 * 60 * 1000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
  });
}
