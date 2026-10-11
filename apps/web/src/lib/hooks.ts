'use client';

import { useMutation, useQuery, useQueryClient, type QueryKey, type UseMutationOptions } from '@tanstack/react-query';
import { isApiError, type ApiClient, type ReportingCurrency } from '@wealthpilot/contracts';
import { errorMessage } from '@wealthpilot/shared';

import { useApi } from './api';
import { LIVE_REFETCH_MS, qk } from './query';
import { useUiStore } from './store';

export { errorMessage };

/** Poll while the tab is visible; TanStack pauses intervals in background tabs. */
const live = { refetchInterval: LIVE_REFETCH_MS, refetchIntervalInBackground: false } as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useMe(enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: qk.me, queryFn: ({ signal }) => api.me.get({ signal }), enabled });
}

/** The currency figures are shown in: this tab's toggle override, else the profile reporting currency. */
export function useDisplayCurrency(): ReportingCurrency {
  const override = useUiStore((s) => s.displayCurrency);
  const me = useMe();
  return override ?? me.data?.reporting_currency ?? 'USD';
}

export function useNetWorth(currency: ReportingCurrency) {
  const api = useApi();
  return useQuery({
    queryKey: qk.netWorth(currency),
    queryFn: ({ signal }) => api.netWorth.get({ currency }, { signal }),
    ...live,
  });
}

export function useNetWorthHistory(currency: ReportingCurrency, months = 12) {
  const api = useApi();
  return useQuery({
    queryKey: qk.netWorthHistory(currency, months),
    queryFn: ({ signal }) => api.netWorth.history({ currency, months }, { signal }),
  });
}

export function useAccounts(includeArchived = false) {
  const api = useApi();
  return useQuery({
    queryKey: qk.accounts(includeArchived),
    queryFn: ({ signal }) => api.accounts.list({ include_archived: includeArchived }, { signal }),
    ...live,
  });
}

export function useAccount(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: qk.account(id ?? ''),
    queryFn: ({ signal }) => api.accounts.get(id ?? '', { signal }),
    enabled: !!id,
  });
}

export function useValuations(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: qk.valuations(id ?? ''),
    queryFn: ({ signal }) => api.accounts.listValuations(id ?? '', { signal }),
    enabled: !!id,
  });
}

export function useGoals() {
  const api = useApi();
  return useQuery({ queryKey: qk.goals, queryFn: ({ signal }) => api.goals.list({ signal }) });
}

export function useGoal(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: qk.goal(id ?? ''),
    queryFn: ({ signal }) => api.goals.get(id ?? '', { signal }),
    enabled: !!id,
  });
}

export function useGrants() {
  const api = useApi();
  return useQuery({ queryKey: qk.grants, queryFn: ({ signal }) => api.rsu.listGrants({ signal }) });
}

export function useGrant(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: qk.grant(id ?? ''),
    queryFn: ({ signal }) => api.rsu.getGrant(id ?? '', { signal }),
    enabled: !!id,
  });
}

export function useVestCalendar(from?: string, to?: string) {
  const api = useApi();
  return useQuery({
    queryKey: qk.calendar(from, to),
    queryFn: ({ signal }) => api.rsu.calendar({ from, to }, { signal }),
  });
}

export function useInsights(currency: ReportingCurrency) {
  const api = useApi();
  return useQuery({
    queryKey: qk.insights(currency),
    queryFn: ({ signal }) => api.insights.list({ currency }, { signal }),
  });
}

export function useScenarios(includeArchived = false) {
  const api = useApi();
  return useQuery({
    queryKey: qk.scenarios(includeArchived),
    queryFn: ({ signal }) => api.scenarios.list({ include_archived: includeArchived }, { signal }),
  });
}

export function useScenario(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: qk.scenario(id ?? ''),
    queryFn: ({ signal }) => api.scenarios.get(id ?? '', { signal }),
    enabled: !!id,
  });
}

export function useScenarioVersions(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: qk.scenarioVersions(id ?? ''),
    queryFn: ({ signal }) => api.scenarios.listVersions(id ?? '', { signal }),
    enabled: !!id,
  });
}

/** Polls a run until it completes or fails. */
export function useRun(id: string | null | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: qk.run(id ?? ''),
    queryFn: ({ signal }) => api.runs.get(id ?? '', { signal }),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'queued' || s === 'running' ? 1500 : false;
    },
  });
}

export function useRunResult(id: string | null | undefined, completed: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: qk.runResult(id ?? ''),
    queryFn: ({ signal }) => api.runs.results(id ?? '', { signal }),
    enabled: !!id && completed,
    staleTime: Infinity, // results are immutable for a run
  });
}

export function useFxRate(base = 'USD', quote = 'INR') {
  const api = useApi();
  return useQuery({
    queryKey: qk.fxRate(base, quote),
    queryFn: ({ signal }) => api.fx.getRate({ base, quote }, { signal }),
    retry: false,
  });
}

export function useInbox() {
  const api = useApi();
  return useQuery({
    queryKey: qk.inbox,
    queryFn: ({ signal }) => api.notifications.inbox(undefined, { signal }),
    ...live,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface ApiMutationOptions<TData, TVars> {
  /** Query keys to invalidate on success (every mutation invalidates what it changes). */
  invalidate?: QueryKey[];
  onSuccess?: (data: TData, vars: TVars) => void;
  onError?: (error: unknown, vars: TVars) => void;
  /**
   * Version-conflict handling (409 VERSION_CONFLICT). When given, the user sees a resolve prompt for this
   * entity; choosing "Load latest" calls `onReload`. Without it a generic prompt reloads everything.
   * Either way nothing is silently overwritten (no last-write-wins).
   */
  conflict?: { entity: string; onReload?: () => void | Promise<void> };
}

/**
 * Wraps useMutation with the app rules: conflicts surface a resolve prompt and PLAN_LIMIT (402) routes to the
 * subscription page via the global MutationCache handler.
 */
export function useApiMutation<TData, TVars = void>(
  fn: (api: ApiClient, vars: TVars) => Promise<TData>,
  opts: ApiMutationOptions<TData, TVars> = {},
) {
  const api = useApi();
  const qc = useQueryClient();
  const showConflict = useUiStore((s) => s.showConflict);
  const options: UseMutationOptions<TData, unknown, TVars> = {
    mutationFn: (vars: TVars) => fn(api, vars),
    meta: { handlesConflict: !!opts.conflict },
    onSuccess: async (data, vars) => {
      await Promise.all((opts.invalidate ?? []).map((queryKey) => qc.invalidateQueries({ queryKey })));
      opts.onSuccess?.(data, vars);
    },
    onError: (error, vars) => {
      if (opts.conflict && isApiError(error) && error.isVersionConflict) {
        const { entity, onReload } = opts.conflict;
        showConflict({
          entity,
          detail: error.detail ?? undefined,
          onReload: async () => {
            await Promise.all((opts.invalidate ?? []).map((queryKey) => qc.invalidateQueries({ queryKey })));
            await onReload?.();
          },
        });
      }
      opts.onError?.(error, vars);
    },
  };
  return useMutation(options);
}
