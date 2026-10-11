'use client';

import type { HomeAssumptions, Scenario } from '@wealthpilot/contracts';
import { D, dec, formatDate, formatMoney, formatRate, mortgagePayment } from '@wealthpilot/shared';
import { Info } from 'lucide-react';

import { PageHeader } from '@/components/app';
import { AssumptionRow, Disclaimer } from '@/components/finance/finance';
import { Money } from '@/components/finance/Money';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { RunStatusBanner } from '../scenarios/RunResultPage';
import { HomeResultView, RunWarnings } from '../scenarios/results';
import { useRunContext } from '../scenarios/useRunContext';
import { PlannerShell } from './PlannerShell';

/** S14 Home planner: inputs, P&I vs all-in, cash-to-close, funding timeline, stress, gaps. No approval claims. */
export function HomePlannerPage() {
  return (
    <div data-testid="home-planner" className="flex flex-col gap-5">
      <PageHeader title="Home planner" description="Down payment, monthly cost and funding timeline from your own assumptions." />
      <Card tone="info" data-testid="no-approval-note">
        <CardContent className="flex-row items-start gap-2 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          A planning estimate from your own assumptions. It is not a mortgage pre-approval, an offer of credit, or a statement of what you can
          afford — lenders decide that.
        </CardContent>
      </Card>
      <PlannerShell kinds={['home']} newKind="home" emptyTitle="Plan a home purchase" focus="home">
        {(s) => <HomePlanner scenario={s} />}
      </PlannerShell>
      <Disclaimer />
    </div>
  );
}

function HomePlanner({ scenario: s }: { scenario: Scenario }) {
  const home = s.active_version?.assumptions.home ?? null;
  const { run, result, ctx } = useRunContext(s.latest_run?.id, s.id);
  return (
    <div className="flex flex-col gap-5">
      {home ? <HomeInputs home={home} /> : <p className="text-sm text-muted-foreground">This scenario has no home purchase enabled. Edit inputs to add one.</p>}
      {s.latest_run ? (
        <RunStatusBanner status={run.data?.status} error={run.data?.error} />
      ) : (
        <p className="text-sm text-muted-foreground">Run the scenario to see results.</p>
      )}
      {result.data?.home ? (
        <>
          <HomeResultView home={result.data.home} result={result.data} ctx={ctx} />
          <RunWarnings result={result.data} />
        </>
      ) : null}
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  us_cash: 'US cash',
  brokerage: 'Brokerage',
  rsu_proceeds: 'Net RSU proceeds',
  india_liquid: 'India liquid',
};

function HomeInputs({ home: h }: { home: HomeAssumptions }) {
  const c = h.currency;
  const down = dec(h.target_price).times(dec(h.down_payment_pct)).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const principal = dec(h.target_price).minus(down);
  const previewPi = mortgagePayment(principal.toFixed(2), h.mortgage_rate_annual, h.term_years);
  const sources = Object.entries(h.funding_sources)
    .filter(([, v]) => v)
    .map(([k]) => SOURCE_LABELS[k] ?? k);
  return (
    <Card data-testid="home-inputs">
      <CardHeader>
        <CardTitle>Inputs (your assumptions)</CardTitle>
      </CardHeader>
      <CardContent>
        {!h.enabled ? <p className="text-sm text-warning-strong dark:text-warning">Home purchase is switched off in this scenario.</p> : null}
        <div className="grid gap-x-8 md:grid-cols-2">
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
        </div>
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          Quick preview of P&amp;I on {formatMoney(principal.toFixed(2), c)}:
          <Money value={previewPi.toFixed(2)} currency={c} compact={false} testId="pi-preview" className="font-semibold text-foreground" />
          /mo (preview — the run result is authoritative)
        </p>
      </CardContent>
    </Card>
  );
}
