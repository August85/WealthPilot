import type { HomeAssumptions, Scenario } from '@wealthpilot/contracts';

import { AssumptionRow, Disclaimer } from '@/components/finance';
import { Money } from '@/components/Money';
import { Card, Icon, Row, Screen, Stack, Text } from '@/components/primitives';
import { formatDate } from '@/lib/dates';
import { D, dec, formatRate, mortgagePayment } from '@/lib/decimal';
import { formatMoney } from '@/lib/money';

import { RunStatusBanner } from '../scenarios/RunResultScreen';
import { HomeResultView, RunWarnings } from '../scenarios/results';
import { useRunContext } from '../scenarios/useRunContext';
import { PlannerShell } from './PlannerShell';

/** S14 Home planner: inputs, P&I vs all-in, cash-to-close, funding timeline, stress, gaps. No approval claims. */
export default function HomePlannerScreen() {
  return (
    <Screen testID="home-planner">
      <Text variant="title">Home planner</Text>
      <Card tone="info" testID="no-approval-note">
        <Row gap={8}>
          <Icon name="information-circle-outline" />
          <Text variant="caption" style={{ flex: 1 }}>
            A planning estimate from your own assumptions. It is not a mortgage pre-approval, an offer of credit, or a
            statement of what you can afford — lenders decide that.
          </Text>
        </Row>
      </Card>
      <PlannerShell kinds={['home']} newKind="home" emptyTitle="Plan a home purchase" focus="home">
        {(s) => <HomePlanner scenario={s} />}
      </PlannerShell>
      <Disclaimer />
    </Screen>
  );
}

function HomePlanner({ scenario: s }: { scenario: Scenario }) {
  const home = s.active_version?.assumptions.home ?? null;
  const { run, result, ctx } = useRunContext(s.latest_run?.id, s.id);
  return (
    <Stack gap={16}>
      {home ? <HomeInputs home={home} /> : <Text tone="muted">This scenario has no home purchase enabled. Edit inputs to add one.</Text>}
      {s.latest_run ? <RunStatusBanner status={run.data?.status} error={run.data?.error} /> : <Text tone="muted">Run the scenario to see results.</Text>}
      {result.data?.home ? (
        <>
          <HomeResultView home={result.data.home} result={result.data} ctx={ctx} />
          <RunWarnings result={result.data} />
        </>
      ) : null}
    </Stack>
  );
}

function HomeInputs({ home: h }: { home: HomeAssumptions }) {
  const c = h.currency;
  const down = dec(h.target_price).times(dec(h.down_payment_pct)).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const principal = dec(h.target_price).minus(down);
  const previewPi = mortgagePayment(principal.toFixed(2), h.mortgage_rate_annual, h.term_years);
  const sources = Object.entries(h.funding_sources)
    .filter(([, v]) => v)
    .map(([k]) => ({ us_cash: 'US cash', brokerage: 'Brokerage', rsu_proceeds: 'Net RSU proceeds', india_liquid: 'India liquid' })[k] ?? k);
  return (
    <Card testID="home-inputs">
      <Text variant="heading">Inputs (your assumptions)</Text>
      {!h.enabled ? <Text tone="warning">Home purchase is switched off in this scenario.</Text> : null}
      <AssumptionRow label="Target price" value={formatMoney(h.target_price, c)} />
      <AssumptionRow label="Purchase date" value={formatDate(h.purchase_date)} />
      <AssumptionRow label="Down payment" value={`${formatRate(h.down_payment_pct)} (${formatMoney(down.toFixed(2), c)})`} />
      <AssumptionRow label="Mortgage rate / term" value={`${formatRate(h.mortgage_rate_annual, 3)} · ${h.term_years} yrs`} />
      <AssumptionRow label="Property tax" value={`${formatRate(h.property_tax_rate_annual)}/yr`} />
      <AssumptionRow label="Insurance" value={`${formatMoney(h.insurance_annual, c)}/yr`} />
      <AssumptionRow label="HOA" value={`${formatMoney(h.hoa_monthly, c)}/mo`} />
      <AssumptionRow label="PMI (while < 20% down)" value={`${formatRate(h.pmi_rate_annual)}/yr`} />
      <AssumptionRow label="Maintenance" value={`${formatRate(h.maintenance_pct_annual)}/yr`} />
      <AssumptionRow label="Utilities" value={`${formatMoney(h.utilities_monthly, c)}/mo`} />
      <AssumptionRow label="Closing costs" value={formatRate(h.closing_cost_pct)} />
      <AssumptionRow label="Emergency reserve" value={formatMoney(h.emergency_reserve, c)} note="Kept as a balance, not spent at closing" />
      <AssumptionRow label="Funding sources" value={sources.join(', ') || 'None'} note="Unvested RSUs and retirement funds are excluded by default" />
      <Row gap={6} wrap>
        <Text variant="caption" tone="muted">
          Quick preview of P&I on {formatMoney(principal.toFixed(2), c)}:
        </Text>
        <Money value={previewPi.toFixed(2)} currency={c} variant="caption" compact={false} testID="pi-preview" />
        <Text variant="caption" tone="muted">
          /mo (preview — the run result below is authoritative)
        </Text>
      </Row>
    </Card>
  );
}
