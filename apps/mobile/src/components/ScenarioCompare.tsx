import type { Comparison } from '@wealthpilot/contracts';

import { METRIC_LABELS, formatMetric } from '../features/scenarios/results';
import { DataTable } from './charts';
import { Stack, Text } from './primitives';

const COMPARE_METRICS = [
  'net_worth_now',
  'liquid_net_worth_now',
  'net_worth_at_retirement',
  'retirement_balance_at_retirement',
  'ending_balance_at_life_expectancy',
  'first_deficit_age',
  'years_in_deficit',
  'home_funding_gap',
  'home_earliest_feasible_date',
  'home_all_in_monthly',
] as const;

/** Side-by-side metrics for up to four runs (FR-SCN-003). */
export function ScenarioCompare({ comparison, currency }: { comparison: Comparison; currency: string }) {
  const runs = comparison.runs;
  return (
    <Stack gap={8}>
      <DataTable
        testID="compare-table"
        caption="Scenario comparison"
        columns={['Metric', ...runs.map((r) => `${r.scenario_name} v${r.version_number}`)]}
        rows={COMPARE_METRICS.filter((m) => runs.some((r) => r.metrics[m] != null)).map((m) => [
          METRIC_LABELS[m] ?? m,
          ...runs.map((r) => formatMetric(m, r.metrics[m], currency)),
        ])}
      />
      <Text variant="caption" tone="muted">
        Deficit ages and years are counts; everything else is in {currency}. Each column uses its own saved assumptions.
      </Text>
    </Stack>
  );
}
