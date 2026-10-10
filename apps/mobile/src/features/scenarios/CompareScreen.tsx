import { useQueries, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import type { Comparison, ComparisonSeriesPoint } from '@wealthpilot/contracts';

import { QueryView } from '@/components/app';
import { ProjectionChart } from '@/components/charts';
import { Disclaimer, ForecastCard, ForecastLabels } from '@/components/finance';
import { Card, Screen, Stack, Text } from '@/components/primitives';
import { ScenarioCompare } from '@/components/ScenarioCompare';
import { useApi } from '@/lib/api';
import { analytics } from '@/lib/analytics';
import { useMe } from '@/lib/hooks';
import { qk } from '@/lib/query';

function seriesFor(c: Comparison, points: ComparisonSeriesPoint[]) {
  return c.runs.map((r) => ({
    key: r.run_id,
    label: `${r.scenario_name} v${r.version_number}`,
    values: points.map((p) => p.values[r.run_id] ?? null),
  }));
}

/** S17 Comparison charts for up to four runs. */
export default function CompareScreen() {
  const { runs } = useLocalSearchParams<{ runs?: string }>();
  const ids = (runs ?? '').split(',').filter(Boolean).slice(0, 4);
  const api = useApi();
  const me = useMe();
  const comparison = useQuery({
    queryKey: qk.comparison(ids),
    // POST /comparisons is a read-only computation over stored runs.
    queryFn: () => api.comparisons.create({ run_ids: ids }),
    enabled: ids.length >= 1,
    staleTime: Infinity,
  });
  // Each run's own result supplies its base date ("As of") and currency for the forecast labels.
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.runResult(id),
      queryFn: () => api.runs.results(id),
      staleTime: Infinity,
    })),
  });
  const baseDate = (runId: string) => results[ids.indexOf(runId)]?.data?.base_date ?? null;
  const commonAsOf = results.map((r) => r.data?.base_date).find(Boolean) ?? null;
  useEffect(() => {
    if (comparison.data) analytics.track('comparison_viewed');
  }, [comparison.data]);
  const currency = results.find((r) => r.data)?.data?.currency ?? me.data?.reporting_currency ?? 'USD';

  return (
    <Screen testID="compare-screen">
      <Text variant="title">Compare scenarios</Text>
      {ids.length < 2 ? (
        <Card tone="info">
          <Text>Select two to four scenarios with completed runs on the Plan tab.</Text>
        </Card>
      ) : null}
      <QueryView query={comparison} loadingLabel="Comparing runs">
        {(c) => (
          <Stack gap={16}>
            {c.runs.map((r) => (
              <Stack key={r.run_id} gap={2}>
                <Text variant="label">{r.scenario_name}</Text>
                <ForecastLabels asOf={baseDate(r.run_id)} scenario={r.scenario_name} assumptions={`v${r.version_number}`} testID={`labels-${r.run_id}`} />
              </Stack>
            ))}
            <ForecastCard title="Key metrics" asOf={commonAsOf} scenario={`${c.runs.length} scenarios`} assumptions="Each scenario’s saved version">
              <ScenarioCompare comparison={c} currency={currency} />
            </ForecastCard>
            <ForecastCard title="Net worth" asOf={commonAsOf} scenario={`${c.runs.length} scenarios`} assumptions="Per scenario">
              <ProjectionChart title="Net worth by year" testID="compare-net-worth" xLabels={c.series.net_worth.map((p) => String(p.year))} series={seriesFor(c, c.series.net_worth)} currency={currency} />
            </ForecastCard>
            <ForecastCard title="Liquid net worth" asOf={commonAsOf} scenario={`${c.runs.length} scenarios`} assumptions="Per scenario">
              <ProjectionChart title="Liquid net worth by year" testID="compare-liquid" xLabels={c.series.liquid_net_worth.map((p) => String(p.year))} series={seriesFor(c, c.series.liquid_net_worth)} currency={currency} />
            </ForecastCard>
            <ForecastCard title="Retirement balance" asOf={commonAsOf} scenario={`${c.runs.length} scenarios`} assumptions="Per scenario">
              <ProjectionChart title="Retirement balance by year" testID="compare-retirement" xLabels={c.series.retirement_balance.map((p) => String(p.year))} series={seriesFor(c, c.series.retirement_balance)} currency={currency} />
            </ForecastCard>
            <Disclaimer />
          </Stack>
        )}
      </QueryView>
    </Screen>
  );
}
