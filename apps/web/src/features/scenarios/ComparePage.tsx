'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import type { Comparison, ComparisonSeriesPoint } from '@wealthpilot/contracts';
import { COMPARE_METRICS, METRIC_LABELS, analytics, formatMetric } from '@wealthpilot/shared';
import { Check, Info } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { PageHeader, QueryView } from '@/components/app';
import { DataTable, ProjectionChart } from '@/components/charts';
import { Disclaimer, ForecastCard, ForecastLabels } from '@/components/finance/finance';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/lib/api';
import { useMe, useScenarios } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { cn } from '@/lib/utils';

function seriesFor(c: Comparison, points: ComparisonSeriesPoint[]) {
  return c.runs.map((r) => ({
    key: r.run_id,
    label: `${r.scenario_name} v${r.version_number}`,
    values: points.map((p) => p.values[r.run_id] ?? null),
  }));
}

/** Side-by-side metrics for up to four runs (FR-SCN-003). */
export function ScenarioCompare({ comparison, currency }: { comparison: Comparison; currency: string }) {
  const runs = comparison.runs;
  return (
    <div className="flex flex-col gap-2">
      <DataTable
        testId="compare-table"
        caption="Scenario comparison"
        columns={['Metric', ...runs.map((r) => `${r.scenario_name} v${r.version_number}`)]}
        rows={COMPARE_METRICS.filter((m) => runs.some((r) => r.metrics[m] != null)).map((m) => [
          METRIC_LABELS[m] ?? m,
          ...runs.map((r) => formatMetric(m, r.metrics[m], currency)),
        ])}
      />
      <p className="text-xs text-muted-foreground">
        Deficit ages and years are counts; everything else is in {currency}. Each column uses its own saved assumptions.
      </p>
    </div>
  );
}

/** Choose up to four scenarios with completed runs. */
function RunPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const scenarios = useScenarios();
  const runnable = (scenarios.data?.items ?? []).filter((s) => s.latest_run?.status === 'completed');
  if (scenarios.isLoading) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose scenarios (2–4)</CardTitle>
      </CardHeader>
      <CardContent>
        {runnable.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed runs yet. Run a scenario first.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Scenarios with completed runs">
            {runnable.map((s) => {
              const runId = s.latest_run?.id ?? '';
              const on = selected.includes(runId);
              const disabled = !on && selected.length >= 4;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={disabled}
                    data-testid={`compare-pick-${s.id}`}
                    onClick={() => onChange(on ? selected.filter((x) => x !== runId) : [...selected, runId])}
                    className={cn(
                      'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
                    )}>
                    {on ? <Check className="size-4" aria-hidden /> : null}
                    {s.name} v{s.active_version?.number ?? '—'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** S17 Comparison charts for up to four runs. */
export function ComparePage() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? '/scenarios/compare';
  const ids = (search?.get('runs') ?? '').split(',').filter(Boolean).slice(0, 4);
  const api = useApi();
  const me = useMe();
  const comparison = useQuery({
    queryKey: qk.comparison(ids),
    // POST /comparisons is a read-only computation over stored runs.
    queryFn: () => api.comparisons.create({ run_ids: ids }),
    enabled: ids.length >= 2,
    staleTime: Infinity,
  });
  // Each run's own result supplies its base date ("As of") and currency for the forecast labels.
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.runResult(id),
      queryFn: () => api.runs.results(id),
      staleTime: Infinity,
      enabled: ids.length >= 2,
    })),
  });
  const baseDate = (runId: string) => results[ids.indexOf(runId)]?.data?.base_date ?? null;
  const commonAsOf = results.map((r) => r.data?.base_date).find(Boolean) ?? null;
  useEffect(() => {
    if (comparison.data) analytics.track('comparison_viewed');
  }, [comparison.data]);
  const currency = results.find((r) => r.data)?.data?.currency ?? me.data?.reporting_currency ?? 'USD';
  const setIds = (next: string[]) => router.replace(next.length ? `${pathname}?runs=${next.join(',')}` : pathname, { scroll: false });

  return (
    <div data-testid="compare-screen" className="flex flex-col gap-5">
      <PageHeader title="Compare scenarios" description="Overlay up to four runs. Each uses its own saved, versioned assumptions." />
      <RunPicker selected={ids} onChange={setIds} />
      {ids.length < 2 ? (
        <p className="flex items-center gap-2 rounded-lg border border-info/30 bg-info-soft p-3 text-sm">
          <Info className="size-4 shrink-0 text-info" aria-hidden /> Select two to four scenarios with completed runs.
        </p>
      ) : (
        <QueryView query={comparison} loadingLabel="Comparing runs">
          {(c) => (
            <div className="flex flex-col gap-5">
              <div className="grid gap-3 md:grid-cols-2">
                {c.runs.map((r) => (
                  <div key={r.run_id} className="flex flex-col gap-1 rounded-lg border bg-card p-3">
                    <p className="text-sm font-semibold">{r.scenario_name}</p>
                    <ForecastLabels asOf={baseDate(r.run_id)} scenario={r.scenario_name} assumptions={`v${r.version_number}`} testId={`labels-${r.run_id}`} />
                  </div>
                ))}
              </div>
              <ForecastCard title="Key metrics" asOf={commonAsOf} scenario={`${c.runs.length} scenarios`} assumptions="Each scenario’s saved version">
                <ScenarioCompare comparison={c} currency={currency} />
              </ForecastCard>
              <div className="grid gap-5 xl:grid-cols-2">
                <ForecastCard title="Net worth" asOf={commonAsOf} scenario={`${c.runs.length} scenarios`} assumptions="Per scenario">
                  <ProjectionChart title="Net worth by year" testId="compare-net-worth" xLabels={c.series.net_worth.map((p) => String(p.year))} series={seriesFor(c, c.series.net_worth)} currency={currency} />
                </ForecastCard>
                <ForecastCard title="Liquid net worth" asOf={commonAsOf} scenario={`${c.runs.length} scenarios`} assumptions="Per scenario">
                  <ProjectionChart title="Liquid net worth by year" testId="compare-liquid" xLabels={c.series.liquid_net_worth.map((p) => String(p.year))} series={seriesFor(c, c.series.liquid_net_worth)} currency={currency} />
                </ForecastCard>
                <ForecastCard title="Retirement balance" asOf={commonAsOf} scenario={`${c.runs.length} scenarios`} assumptions="Per scenario" className="xl:col-span-2">
                  <ProjectionChart title="Retirement balance by year" testId="compare-retirement" xLabels={c.series.retirement_balance.map((p) => String(p.year))} series={seriesFor(c, c.series.retirement_balance)} currency={currency} />
                </ForecastCard>
              </div>
              <Disclaimer />
            </div>
          )}
        </QueryView>
      )}
    </div>
  );
}
