'use client';

import { contextLabel, type ForecastContext } from '@wealthpilot/shared';

import { useRun, useRunResult, useScenario, useScenarioVersions } from '@/lib/hooks';

/** Loads a run, its results (once completed) and the scenario/version labels every forecast card needs. */
export function useRunContext(runId: string | null | undefined, scenarioId?: string | null) {
  const run = useRun(runId);
  const completed = run.data?.status === 'completed';
  const result = useRunResult(runId, completed);
  const scenario = useScenario(scenarioId ?? undefined);
  const versions = useScenarioVersions(scenarioId ?? undefined);
  const version =
    versions.data?.items.find((v) => v.id === run.data?.scenario_version_id) ??
    (scenario.data?.active_version?.id === run.data?.scenario_version_id ? scenario.data?.active_version : undefined);
  const ctx: ForecastContext = {
    asOf: result.data?.base_date ?? version?.snapshot?.as_of ?? null,
    scenario: scenario.data?.name ?? null,
    assumptions: contextLabel(version?.number, result.data?.input_hash ?? version?.input_hash),
  };
  return { run, result, scenario, version, ctx };
}
