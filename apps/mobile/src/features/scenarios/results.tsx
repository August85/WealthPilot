import { router } from 'expo-router';
import { useState } from 'react';

import type { HomeResult, RunResult, ScenarioAssumptions, YearlyRow } from '@wealthpilot/contracts';
import { METRIC_LABELS, deflate, formatAssumptionValue, formatMetric, type ForecastContext } from '@wealthpilot/shared';

import { DataTable, ProjectionChart } from '@/components/charts';
import { AssumptionRow, ForecastCard, KeyValue, WarningPanel } from '@/components/finance';
import { Money } from '@/components/Money';
import { Card, Chip, LinkRow, Row, Stack, Text } from '@/components/primitives';
import { formatDate, formatMonthYear } from '@/lib/dates';
import { dec, formatRate } from '@/lib/decimal';
import { formatMoney } from '@/lib/money';

export { METRIC_LABELS, contextLabel, deflate, formatMetric, type ForecastContext } from '@wealthpilot/shared';

export function ExplainLink({ runId, metric, label }: { runId: string; metric: string; label?: string }) {
  return (
    <LinkRow
      icon="calculator-outline"
      title={label ?? `Explain ${METRIC_LABELS[metric] ?? metric}`}
      onPress={() => router.push({ pathname: '/runs/explain', params: { run: runId, metric } })}
      testID={`explain-${metric}`}
    />
  );
}

export function MetricsCard({ result, ctx, keys }: { result: RunResult; ctx: ForecastContext; keys?: string[] }) {
  const entries = Object.entries(result.metrics).filter(([k, v]) => (keys ? keys.includes(k) : true) && v !== null);
  const explainable = new Set(result.explanations.map((e) => e.metric));
  return (
    <ForecastCard title="Key results" {...ctx} testID="metrics-card">
      {entries.map(([k, v]) => (
        <AssumptionRow
          key={k}
          label={METRIC_LABELS[k] ?? k}
          value={formatMetric(k, v, result.currency)}
          onExplain={explainable.has(k) ? () => router.push({ pathname: '/runs/explain', params: { run: result.run_id, metric: k } }) : undefined}
        />
      ))}
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
    <Stack gap={16}>
      <ForecastCard title="Monthly housing cost" {...ctx} testID="home-monthly">
        <Row wrap gap={24}>
          <Stack gap={2}>
            <Text variant="label" tone="muted">
              Principal & interest
            </Text>
            <Money value={home.pi_monthly} currency={c} variant="title" testID="home-pi" />
          </Stack>
          <Stack gap={2}>
            <Text variant="label" tone="muted">
              All-in housing payment
            </Text>
            <Money value={ai.total} currency={c} variant="title" testID="home-all-in" />
          </Stack>
        </Row>
        <Text variant="caption" tone="muted">
          All-in = P&I + property tax + insurance + HOA + PMI + maintenance + utilities. Changing HOA changes all-in but not P&I.
        </Text>
        <KeyValue label="Principal & interest">
          <Money value={ai.principal_interest} currency={c} compact={false} />
        </KeyValue>
        <KeyValue label="Property tax">
          <Money value={ai.property_tax} currency={c} compact={false} />
        </KeyValue>
        <KeyValue label="Insurance">
          <Money value={ai.insurance} currency={c} compact={false} />
        </KeyValue>
        <KeyValue label="HOA">
          <Money value={ai.hoa} currency={c} compact={false} />
        </KeyValue>
        <KeyValue label="PMI">
          <Money value={ai.pmi} currency={c} compact={false} />
        </KeyValue>
        <KeyValue label="Maintenance">
          <Money value={ai.maintenance} currency={c} compact={false} />
        </KeyValue>
        <KeyValue label="Utilities">
          <Money value={ai.utilities} currency={c} compact={false} />
        </KeyValue>
        <ExplainLink runId={result.run_id} metric="home_pi_monthly" />
      </ForecastCard>

      <ForecastCard title="Cash to close" {...ctx} testID="home-cash">
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
        <KeyValue label="Cash to close">
          <Money value={home.cash_to_close} currency={c} variant="bodyStrong" compact={false} testID="cash-to-close" />
        </KeyValue>
        <KeyValue label="Emergency reserve (kept, not spent)">
          <Money value={home.emergency_reserve} currency={c} compact={false} />
        </KeyValue>
        <KeyValue label="Total cash needed">
          <Money value={home.total_cash_needed} currency={c} variant="bodyStrong" compact={false} />
        </KeyValue>
        <KeyValue label="Projected available at purchase">
          <Money value={m.home_cash_available_at_purchase} currency={c} compact={false} />
        </KeyValue>
        {gap ? (
          <Card tone={gap.gt(0) ? 'warning' : 'success'} testID="home-gap">
            <Text variant="bodyStrong">
              {gap.gt(0) ? '⚠ Funding gap: ' : '✓ No funding gap. Surplus: '}
              {formatMoney(gap.abs().toFixed(2), c)}
            </Text>
            {m.home_earliest_feasible_date ? (
              <Text variant="caption">Earliest feasible date under these assumptions: {formatDate(m.home_earliest_feasible_date)}</Text>
            ) : gap.gt(0) ? (
              <Text variant="caption">Not feasible within the horizon under these assumptions.</Text>
            ) : null}
          </Card>
        ) : null}
        <ExplainLink runId={result.run_id} metric="home_cash_needed" />
      </ForecastCard>

      <ForecastCard title="Down-payment funding timeline" {...ctx}>
        <ProjectionChart
          title="Available vs required cash"
          testID="funding-chart"
          xLabels={home.funding_timeline.map((p) => formatMonthYear(p.month))}
          series={[
            { key: 'available', label: 'Available (goal-eligible)', values: home.funding_timeline.map((p) => p.available) },
            { key: 'required', label: 'Required', values: home.funding_timeline.map((p) => p.required) },
          ]}
          currency={c}
        />
        <Text variant="caption" tone="muted">
          Excludes unvested RSUs and retirement funds unless your assumptions include future vest proceeds.
        </Text>
      </ForecastCard>

      <ForecastCard title="Stress tests" {...ctx} testID="home-stress">
        <DataTable
          caption="Stress tests"
          testID="stress-table"
          columns={['Scenario', 'P&I / month', 'All-in / month', 'Funding gap']}
          rows={home.stress.map((s) => [s.label, formatMoney(s.pi_monthly, c), formatMoney(s.all_in_monthly, c), formatMoney(s.funding_gap, c)])}
        />
      </ForecastCard>
    </Stack>
  );
}

export function YearlyView({
  result,
  ctx,
  assumptions,
}: {
  result: RunResult;
  ctx: ForecastContext;
  assumptions?: ScenarioAssumptions | null;
}) {
  const [real, setReal] = useState(false);
  const rows = result.yearly;
  const c = result.currency;
  const baseYear = Number(result.base_date.slice(0, 4));
  const inflation =
    assumptions?.retirement.location === 'IN' ? assumptions?.inflation.india_annual : assumptions?.inflation.us_annual;
  const canReal = !!inflation;
  const val = (k: keyof YearlyRow) => (real && inflation ? deflate(rows, k, inflation, baseYear) : rows.map((r) => r[k] as string));
  const deficits = rows.map((r) => dec(r.deficit).gt(0));
  const xLabels = rows.map((r) => `${r.year} (${r.age})`);
  const deficitYears = rows.filter((r) => dec(r.deficit).gt(0));
  return (
    <Stack gap={16}>
      <ForecastCard title="Balances by year" {...ctx} testID="yearly-balances">
        <Row gap={8} accessibilityRole="radiogroup" accessibilityLabel="Nominal or real values">
          <Chip label="Nominal" selected={!real} onPress={() => setReal(false)} testID="nominal" />
          <Chip
            label="Real (today’s money)"
            selected={real}
            onPress={canReal ? () => setReal(true) : undefined}
            testID="real"
          />
        </Row>
        {real && inflation ? (
          <Text variant="caption" tone="muted">
            Real = nominal ÷ (1 + {formatRate(inflation)})^years since {baseYear}, using this scenario’s{' '}
            {assumptions?.retirement.location === 'IN' ? 'India' : 'US'} inflation assumption.
          </Text>
        ) : null}
        <ProjectionChart
          title={real ? 'Net worth and retirement balance (real)' : 'Net worth and retirement balance (nominal)'}
          testID="balance-chart"
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
      <ForecastCard title="Cash flow by year" {...ctx} testID="yearly-cashflow">
        <ProjectionChart
          title="Income, expenses and withdrawals"
          kind="bar"
          testID="cashflow-chart"
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
          <Card tone="warning" testID="deficit-years">
            <Text variant="bodyStrong">⚠ {deficitYears.length} deficit year(s)</Text>
            <Text variant="caption">
              {deficitYears
                .slice(0, 12)
                .map((r) => `${r.year} (age ${r.age}): ${formatMoney(r.deficit, c)}`)
                .join(' · ')}
              {deficitYears.length > 12 ? ' …' : ''}
            </Text>
          </Card>
        ) : (
          <Text tone="success">✓ No deficit years under these assumptions.</Text>
        )}
      </ForecastCard>
    </Stack>
  );
}

export function SensitivityView({ result }: { result: RunResult }) {
  if (!result.sensitivity.length) return null;
  const c = result.currency;
  return (
    <Card testID="sensitivity">
      <Text variant="heading">Sensitivity (one variable at a time)</Text>
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
    </Card>
  );
}

export function RunWarnings({ result }: { result: RunResult }) {
  return <WarningPanel warnings={result.warnings} />;
}

export function Reproducibility({ result }: { result: RunResult }) {
  return (
    <Card>
      <Text variant="heading">Reproducibility</Text>
      <KeyValue label="Run ID">{result.run_id}</KeyValue>
      <KeyValue label="Model version">{result.model_version}</KeyValue>
      <KeyValue label="Rule pack">{`${result.rulepack_version} (no tax rules; illustrative rates)`}</KeyValue>
      <KeyValue label="Input hash">{result.input_hash}</KeyValue>
      <KeyValue label="Result checksum">{result.checksum}</KeyValue>
    </Card>
  );
}
