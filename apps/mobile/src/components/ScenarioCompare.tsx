import type { Comparison } from '@wealthpilot/contracts';

import { COMPARE_METRICS, METRIC_LABELS, formatMetric } from '@wealthpilot/shared';
import { DataTable } from './charts';
import { Stack, Text } from './primitives';

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
