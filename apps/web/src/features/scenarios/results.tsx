'use client';

import type { HomeResult, RunResult, ScenarioAssumptions, YearlyRow } from '@wealthpilot/contracts';
import {
  METRIC_LABELS,
  dec,
  deflate,
  formatAssumptionValue,
  formatDate,
  formatMoney,
  formatMonthYear,
  formatRate,
  formatMetric,
  type ForecastContext,
} from '@wealthpilot/shared';
import { AlertTriangle, Calculator, CheckCircle2, Fingerprint } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ChipGroup } from '@/components/form';
import { DataTable, ProjectionChart } from '@/components/charts';
import { AssumptionRow, ForecastCard, KeyValue, KeyValueList, WarningPanel } from '@/components/finance/finance';
import { Money } from '@/components/finance/Money';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function explainHref(runId: string, metric: string) {
  return `/runs/${runId}/explain?metric=${encodeURIComponent(metric)}`;
}

export function ExplainLink({ runId, metric, label }: { runId: string; metric: string; label?: string }) {
  return (
    <Link
      href={explainHref(runId, metric)}
      data-testid={`explain-${metric}`}
      className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-link hover:underline focus-visible:outline-2 focus-visible:outline-ring">
      <Calculator className="size-4" aria-hidden />
      {label ?? `Explain ${METRIC_LABELS[metric] ?? metric}`}
    </Link>
  );
}

export function MetricsCard({ result, ctx, keys }: { result: RunResult; ctx: ForecastContext; keys?: string[] }) {
  const entries = Object.entries(result.metrics).filter(([k, v]) => (keys ? keys.includes(k) : true) && v !== null);
  const explainable = new Set(result.explanations.map((e) => e.metric));
  return (
    <ForecastCard title="Key results" {...ctx} testId="metrics-card">
      <div className="grid gap-x-8 sm:grid-cols-2">
        {entries.map(([k, v]) => (
          <AssumptionRow
            key={k}
            label={METRIC_LABELS[k] ?? k}
            value={formatMetric(k, v, result.currency)}
            action={
              explainable.has(k) ? (
                <Link
                  href={explainHref(result.run_id, k)}
                  className="ml-1 rounded p-1 text-link hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={`Explain ${METRIC_LABELS[k] ?? k}`}
                  title="Explain this calculation">
                  <Calculator className="size-3.5" aria-hidden />
                </Link>
              ) : undefined
            }
          />
        ))}
      </div>
    </ForecastCard>
  );
}

/** S14 core: P&I vs all-in, cash to close, funding timeline, stress table. */
export function HomeResultView({ home, result, ctx }: { home: HomeResult; result: RunResult; ctx: ForecastContext }) {
  const c = result.currency;
  const m = result.metrics;
  const gap = m.home_funding_gap ? dec(m.home_funding_gap) : null;
  const ai = home.all_in_monthly;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ForecastCard title="Monthly housing cost" {...ctx} testId="home-monthly">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Principal &amp; interest</p>
            <Money value={home.pi_monthly} currency={c} className="text-2xl font-semibold" testId="home-pi" />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">All-in housing payment</p>
            <Money value={ai.total} currency={c} className="text-2xl font-semibold" testId="home-all-in" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          All-in = P&amp;I + property tax + insurance + HOA + PMI + maintenance + utilities. Changing HOA changes all-in but not P&amp;I.
        </p>
        <KeyValueList>
          {(
            [
              ['Principal & interest', ai.principal_interest],
              ['Property tax', ai.property_tax],
              ['Insurance', ai.insurance],
              ['HOA', ai.hoa],
              ['PMI', ai.pmi],
              ['Maintenance', ai.maintenance],
              ['Utilities', ai.utilities],
            ] as const
          ).map(([label, v]) => (
            <KeyValue key={label} label={label}>
              <Money value={v} currency={c} compact={false} />
            </KeyValue>
          ))}
        </KeyValueList>
        <ExplainLink runId={result.run_id} metric="home_pi_monthly" />
      </ForecastCard>

      <ForecastCard title="Cash to close" {...ctx} testId="home-cash">
        <KeyValueList>
          <KeyValue label="Purchase date">{formatDate(home.purchase_date)}</KeyValue>
          <KeyValue label="Price">
            <Money value={home.price} currency={c} compact={false} />
          </KeyValue>
          <KeyValue label="Down payment">
            <Money value={home.down_payment} currency={c} compact={false} />
          </KeyValue>
          <KeyValue label="Loan principal">
            <Money value={home.loan_principal} currency={c} compact={false} />
          </KeyValue>
          <KeyValue label="Closing costs">
            <Money value={home.closing_costs} currency={c} compact={false} />
          </KeyValue>
          <KeyValue label="Prepaid costs">
            <Money value={home.prepaid_costs} currency={c} compact={false} />
          </KeyValue>
          <KeyValue label="Less verified credits">
            <Money value={home.credits} currency={c} compact={false} />
          </KeyValue>
          <KeyValue label="Cash to close" className="font-semibold">
            <Money value={home.cash_to_close} currency={c} compact={false} testId="cash-to-close" className="font-semibold" />
          </KeyValue>
          <KeyValue label="Emergency reserve (kept, not spent)">
            <Money value={home.emergency_reserve} currency={c} compact={false} />
          </KeyValue>
          <KeyValue label="Total cash needed">
            <Money value={home.total_cash_needed} currency={c} compact={false} className="font-semibold" />
          </KeyValue>
          <KeyValue label="Projected available at purchase">
            <Money value={m.home_cash_available_at_purchase} currency={c} compact={false} />
          </KeyValue>
        </KeyValueList>
        {gap ? (
          <div
            data-testid="home-gap"
            className={cn(
              'flex items-start gap-2 rounded-lg border p-3 text-sm',
              gap.gt(0) ? 'border-dashed border-warning bg-warning-soft' : 'border-success/40 bg-success-soft',
            )}>
            {gap.gt(0) ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-strong dark:text-warning" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            )}
            <div>
              <p className="font-semibold">
                {gap.gt(0) ? 'Funding gap: ' : 'No funding gap. Surplus: '}
                {formatMoney(gap.abs().toFixed(2), c)}
              </p>
              {m.home_earliest_feasible_date ? (
                <p className="text-xs">Earliest feasible date under these assumptions: {formatDate(m.home_earliest_feasible_date)}</p>
              ) : gap.gt(0) ? (
                <p className="text-xs">Not feasible within the horizon under these assumptions.</p>
              ) : null}
            </div>
          </div>
        ) : null}
        <ExplainLink runId={result.run_id} metric="home_cash_needed" />
      </ForecastCard>

      <ForecastCard title="Down-payment funding timeline" {...ctx} className="xl:col-span-2">
        <ProjectionChart
          title="Available vs required cash"
          testId="funding-chart"
          xLabels={home.funding_timeline.map((p) => formatMonthYear(p.month))}
          series={[
            { key: 'available', label: 'Available (goal-eligible)', values: home.funding_timeline.map((p) => p.available) },
            { key: 'required', label: 'Required', values: home.funding_timeline.map((p) => p.required) },
          ]}
          currency={c}
        />
        <p className="text-xs text-muted-foreground">Excludes unvested RSUs and retirement funds unless your assumptions include future vest proceeds.</p>
      </ForecastCard>

      <ForecastCard title="Stress tests" {...ctx} testId="home-stress" className="xl:col-span-2">
        <DataTable
          caption="Stress tests"
          testId="stress-table"
          columns={['Scenario', 'P&I / month', 'All-in / month', 'Funding gap']}
          rows={home.stress.map((s) => [s.label, formatMoney(s.pi_monthly, c), formatMoney(s.all_in_monthly, c), formatMoney(s.funding_gap, c)])}
        />
      </ForecastCard>
    </div>
  );
}

type Mode = 'nominal' | 'real';

export function YearlyView({ result, ctx, assumptions }: { result: RunResult; ctx: ForecastContext; assumptions?: ScenarioAssumptions | null }) {
  const [mode, setMode] = useState<Mode>('nominal');
  const rows = result.yearly;
  const c = result.currency;
  const baseYear = Number(result.base_date.slice(0, 4));
  const inflation = assumptions?.retirement.location === 'IN' ? assumptions?.inflation.india_annual : assumptions?.inflation.us_annual;
  const real = mode === 'real' && !!inflation;
  const val = (k: keyof YearlyRow) => (real && inflation ? deflate(rows, k, inflation, baseYear) : rows.map((r) => r[k] as string));
  const deficits = rows.map((r) => dec(r.deficit).gt(0));
  const xLabels = rows.map((r) => `${r.year} (${r.age})`);
  const deficitYears = rows.filter((r) => dec(r.deficit).gt(0));
  if (rows.length === 0) return null;
  const toggle = (
    <ChipGroup<Mode>
      ariaLabel="Nominal or real values"
      value={mode}
      onChange={(m) => setMode(m === 'real' && !inflation ? 'nominal' : m)}
      testIdPrefix="value-mode"
      options={[
        { value: 'nominal', label: 'Nominal' },
        { value: 'real', label: 'Real (today’s money)' },
      ]}
    />
  );
  return (
    <div className="grid gap-5">
      <ForecastCard title="Balances by year" {...ctx} testId="yearly-balances" action={toggle}>
        {real && inflation ? (
          <p className="text-xs text-muted-foreground">
            Real = nominal ÷ (1 + {formatRate(inflation)})^years since {baseYear}, using this scenario’s {assumptions?.retirement.location === 'IN' ? 'India' : 'US'} inflation
            assumption.
          </p>
        ) : null}
        <ProjectionChart
          title={real ? 'Net worth and retirement balance (real)' : 'Net worth and retirement balance (nominal)'}
          testId="balance-chart"
          xLabels={xLabels}
          series={[
            { key: 'nw', label: 'Net worth', values: val('net_worth') },
            { key: 'ret', label: 'Retirement balance', values: val('retirement_balance') },
            { key: 'liq', label: 'Liquid', values: val('liquid') },
          ]}
          currency={c}
          highlight={deficits}
          highlightLabel="Deficit year"
        />
      </ForecastCard>
      <ForecastCard title="Cash flow by year" {...ctx} testId="yearly-cashflow">
        <ProjectionChart
          title={real ? 'Income, expenses and withdrawals (real)' : 'Income, expenses and withdrawals (nominal)'}
          kind="bar"
          testId="cashflow-chart"
          xLabels={xLabels}
          series={[
            { key: 'income', label: 'Income', values: val('income') },
            { key: 'expenses', label: 'Expenses', values: val('expenses') },
            { key: 'withdrawals', label: 'Withdrawals', values: val('withdrawals') },
          ]}
          currency={c}
          highlight={deficits}
          highlightLabel="Deficit year"
        />
        {deficitYears.length ? (
          <div data-testid="deficit-years" className="rounded-lg border border-dashed border-warning bg-warning-soft p-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="size-4 text-warning-strong dark:text-warning" aria-hidden /> {deficitYears.length} deficit year(s)
            </p>
            <p className="text-xs">
              {deficitYears
                .slice(0, 12)
                .map((r) => `${r.year} (age ${r.age}): ${formatMoney(r.deficit, c)}`)
                .join(' · ')}
              {deficitYears.length > 12 ? ' …' : ''}
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden /> No deficit years under these assumptions.
          </p>
        )}
      </ForecastCard>
    </div>
  );
}

export function SensitivityView({ result }: { result: RunResult }) {
  if (!result.sensitivity.length) return null;
  const c = result.currency;
  return (
    <Card data-testid="sensitivity" className="xl:col-span-2">
      <CardHeader>
        <CardTitle>Sensitivity (one variable at a time)</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          caption="Sensitivity"
          columns={['Variable', 'Metric', 'Low', 'Base', 'High']}
          rows={result.sensitivity.map((s) => [
            s.label,
            METRIC_LABELS[s.metric] ?? s.metric,
            `${formatMoney(s.low_result, c)} (${formatAssumptionValue(s.variable, s.low_input, c)})`,
            formatMoney(s.base_result, c),
            `${formatMoney(s.high_result, c)} (${formatAssumptionValue(s.variable, s.high_input, c)})`,
          ])}
        />
      </CardContent>
    </Card>
  );
}

export function RunWarnings({ result }: { result: RunResult }) {
  return <WarningPanel warnings={result.warnings} />;
}

export function Reproducibility({ result }: { result: RunResult }) {
  return (
    <Card data-testid="reproducibility">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="size-4 text-muted-foreground" aria-hidden /> Reproducibility
        </CardTitle>
      </CardHeader>
      <CardContent>
        <KeyValueList>
          <KeyValue label="Run ID">
            <span className="font-mono text-xs">{result.run_id}</span>
          </KeyValue>
          <KeyValue label="Model version">{result.model_version}</KeyValue>
          <KeyValue label="Rule pack">{`${result.rulepack_version} (no tax rules; illustrative rates)`}</KeyValue>
          <KeyValue label="Input hash">
            <span className="font-mono text-xs">{result.input_hash}</span>
          </KeyValue>
          <KeyValue label="Result checksum">
            <span className="font-mono text-xs">{result.checksum}</span>
          </KeyValue>
        </KeyValueList>
      </CardContent>
    </Card>
  );
}
