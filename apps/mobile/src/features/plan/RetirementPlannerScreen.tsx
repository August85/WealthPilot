import type { Scenario } from '@wealthpilot/contracts';

import { AssumptionRow, Disclaimer } from '@/components/finance';
import { Card, Screen, Stack, Text } from '@/components/primitives';
import { formatRate } from '@/lib/decimal';
import { formatMoney } from '@/lib/money';

import { RunStatusBanner } from '../scenarios/RunResultScreen';
import { ExplainLink, MetricsCard, RunWarnings, SensitivityView, YearlyView } from '../scenarios/results';
import { WITHDRAWAL_LABELS } from '../scenarios/assumptionFields';
import { useRunContext } from '../scenarios/useRunContext';
import { PlannerShell } from './PlannerShell';

/** S15 Retirement planner: inputs, yearly cash-flow/balance chart, deficit years, nominal vs real. */
export default function RetirementPlannerScreen() {
  return (
    <Screen testID="retirement-planner">
      <Text variant="title">Retirement planner</Text>
      <Text tone="muted">
        No safe withdrawal rate is assumed to be universally appropriate. Results depend entirely on the assumptions below.
      </Text>
      <PlannerShell kinds={['retirement', 'general']} newKind="retirement" emptyTitle="Plan your retirement" focus="retirement">
        {(s) => <RetirementPlanner scenario={s} />}
      </PlannerShell>
      <Disclaimer />
    </Screen>
  );
}

function RetirementPlanner({ scenario: s }: { scenario: Scenario }) {
  const a = s.active_version?.assumptions;
  const { run, result, version, ctx } = useRunContext(s.latest_run?.id, s.id);
  return (
    <Stack gap={16}>
      {a ? (
        <Card testID="retirement-inputs">
          <Text variant="heading">Inputs (your assumptions)</Text>
          <AssumptionRow label="Age now / retire / plan to" value={`${a.household.current_age} / ${a.household.retirement_age} / ${a.household.life_expectancy}`} />
          <AssumptionRow label="Retire in" value={a.retirement.location === 'IN' ? 'India' : 'United States'} />
          <AssumptionRow label="Spending (today’s money)" value={`${formatMoney(a.retirement.spending_monthly_today, a.reporting_currency)}/mo`} />
          <AssumptionRow label="Healthcare (today’s money)" value={`${formatMoney(a.retirement.healthcare_monthly_today, a.reporting_currency)}/mo · +${formatRate(a.retirement.healthcare_inflation_annual)}/yr`} />
          <AssumptionRow label="Inflation US / India" value={`${formatRate(a.inflation.us_annual)} / ${formatRate(a.inflation.india_annual)}`} />
          <AssumptionRow label="Returns US / India" value={`${formatRate(a.returns.us_portfolio_annual)} / ${formatRate(a.returns.india_portfolio_annual)}`} />
          <AssumptionRow label="INR depreciation" value={`${formatRate(a.fx.inr_depreciation_annual)}/yr from ${a.fx.usd_inr_start}`} />
          <AssumptionRow label="Social Security (your estimate, unverified)" value={`${formatMoney(a.retirement.social_security_monthly_today, 'USD')}/mo from ${a.retirement.social_security_start_age}`} />
          <AssumptionRow label="Withdrawal order" value={a.retirement.withdrawal_order.map((b) => WITHDRAWAL_LABELS[b] ?? b).join(' → ')} />
          <AssumptionRow label="Withdrawal tax (illustrative)" value={formatRate(a.retirement.withdrawal_tax_rate)} />
          {a.epf && a.epf.accessible_from_age == null ? (
            <Text variant="caption" tone="warning">
              ⚠ EPF is treated as not accessible (no verified access age).
            </Text>
          ) : null}
        </Card>
      ) : null}
      {s.latest_run ? <RunStatusBanner status={run.data?.status} error={run.data?.error} /> : <Text tone="muted">Run the scenario to see results.</Text>}
      {result.data ? (
        <>
          <MetricsCard
            result={result.data}
            ctx={ctx}
            keys={['net_worth_at_retirement', 'retirement_balance_at_retirement', 'ending_balance_at_life_expectancy', 'first_deficit_age', 'years_in_deficit']}
          />
          <YearlyView result={result.data} ctx={ctx} assumptions={version?.assumptions ?? a} />
          <SensitivityView result={result.data} />
          <ExplainLink runId={result.data.run_id} metric="ending_balance_at_life_expectancy" />
          <RunWarnings result={result.data} />
        </>
      ) : null}
    </Stack>
  );
}
