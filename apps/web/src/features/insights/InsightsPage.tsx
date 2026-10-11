'use client';

import type { Insight, NetWorth, Severity } from '@wealthpilot/contracts';
import { analytics, dec, formatDate, liquidityRisk, pctText, riskLevel, shareOf } from '@wealthpilot/shared';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Lock, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { EmptyState, PageHeader, QueryView } from '@/components/app';
import { CurrencyToggle, Disclaimer, RiskIndicator } from '@/components/finance/finance';
import { Money } from '@/components/finance/Money';
import { Pill } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useDisplayCurrency, useInsights, useNetWorth } from '@/lib/hooks';
import { useUiStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const SEVERITY_META: Record<Severity, { icon: LucideIcon; label: string; cls: string }> = {
  info: { icon: Info, label: 'Info', cls: 'text-info' },
  warning: { icon: AlertTriangle, label: 'Warning', cls: 'text-warning-strong dark:text-warning' },
  critical: { icon: AlertCircle, label: 'Important', cls: 'text-danger' },
};
const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** S19 Insights: deterministic insights from the API plus exposure indicators from the net-worth breakdown. */
export function InsightsPage() {
  const currency = useDisplayCurrency();
  const setDisplayCurrency = useUiStore((s) => s.setDisplayCurrency);
  const insights = useInsights(currency);
  const netWorth = useNetWorth(currency);
  return (
    <div data-testid="insights-screen" className="flex flex-col gap-5">
      <PageHeader
        title="Insights"
        description="Rule-based observations about your own data. They are not recommendations to buy, sell or move money."
        actions={
          <CurrencyToggle
            value={currency}
            onChange={(c) => {
              setDisplayCurrency(c);
              analytics.track('currency_toggled', { currency: c, screen: 'insights' });
            }}
          />
        }
      />
      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <QueryView query={netWorth} loadingLabel="Loading exposure">
          {(nw) => <Exposure nw={nw} />}
        </QueryView>
        <section className="flex flex-col gap-3" aria-label="Observations">
          <h2 className="text-lg font-semibold">Observations</h2>
          <QueryView query={insights} loadingLabel="Loading insights">
            {(data) =>
              data.items.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="Nothing to flag right now" body="Insights appear as you add accounts, RSU grants and goals." />
              ) : (
                <div className="flex flex-col gap-3">
                  {[...data.items]
                    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
                    .map((i, idx) => (
                      <InsightCard key={`${i.code}-${idx}`} insight={i} />
                    ))}
                </div>
              )
            }
          </QueryView>
        </section>
      </div>
      <Disclaimer compact />
    </div>
  );
}

function Exposure({ nw }: { nw: NetWorth }) {
  const inr = nw.by_currency.find((c) => c.key === 'INR');
  const inrShare = shareOf(inr?.amount ?? '0', nw.gross_assets);
  const liquidShare = shareOf(nw.liquid_net_worth, nw.net_worth);
  const largest = [...nw.items].filter((i) => i.kind === 'asset').sort((a, b) => dec(b.amount).comparedTo(dec(a.amount)))[0];
  const largestShare = largest ? shareOf(largest.amount, nw.gross_assets) : null;
  // Impact of a 10% move in INR on the reporting-currency value of INR holdings (illustrative).
  const inrMove = inr ? dec(inr.amount).times('0.10').toFixed(2) : null;
  return (
    <Card data-testid="exposure-card" className="h-fit">
      <CardHeader className="flex-col">
        <CardTitle>Exposure</CardTitle>
        <CardDescription>
          As of {formatDate(nw.as_of)} · in {nw.currency} · thresholds: medium ≥ 25%, high ≥ 50%
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-1">
        {largest && largestShare ? (
          <RiskIndicator level={riskLevel(largestShare, '0.25', '0.5')} label="Largest single holding" detail={`${largest.name} is ${pctText(largestShare)} of gross assets`} />
        ) : null}
        {inrShare ? <RiskIndicator level={riskLevel(inrShare, '0.25', '0.5')} label="INR currency exposure" detail={`${pctText(inrShare)} of gross assets is held in INR`} /> : null}
        {liquidShare ? (
          <RiskIndicator level={liquidityRisk(liquidShare)} label="Low liquidity" detail={`${pctText(liquidShare)} of net worth is liquid (medium < 25%, high < 10%)`} />
        ) : null}
        {inrMove && dec(inrMove).gt(0) ? (
          <div data-testid="inr-move" className="mt-2 rounded-lg bg-muted p-3 text-xs">
            <p>
              A 10% move in USD/INR changes the {nw.currency} value of your INR holdings by about{' '}
              <Money value={inrMove} currency={nw.currency} compact={false} className="font-semibold" />.
            </p>
            <p className="text-muted-foreground">Illustrative sensitivity, not a forecast.</p>
          </div>
        ) : null}
        {dec(nw.unvested_equity_excluded).gt(0) ? (
          <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden /> Unvested equity excluded from net worth:{' '}
            <Money value={nw.unvested_equity_excluded} currency={nw.currency} compact={false} />
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function refHref(i: Insight): string | null {
  const ref = i.refs[0];
  if (!ref) return null;
  if (ref.ref_type === 'account') return `/accounts/${ref.ref_id}`;
  if (ref.ref_type === 'rsu_grant') return `/rsu/${ref.ref_id}`;
  if (ref.ref_type === 'goal') return `/goals/${ref.ref_id}`;
  return null;
}

function InsightCard({ insight: i }: { insight: Insight }) {
  const meta = SEVERITY_META[i.severity] ?? SEVERITY_META.info;
  const Icon = meta.icon;
  const href = refHref(i);
  return (
    <Card tone={i.severity === 'critical' ? 'danger' : i.severity === 'warning' ? 'warning' : 'default'} data-testid={`insight-${i.code}`}>
      <CardContent className="gap-2 py-4">
        <div className="flex items-center gap-2">
          <Icon className={cn('size-4 shrink-0', meta.cls)} aria-hidden />
          <p className="flex-1 font-semibold">{i.title}</p>
          <Pill icon={<Icon aria-hidden />}>{meta.label}</Pill>
        </div>
        <p className="text-sm">{i.body}</p>
        {href ? (
          <Link href={href} className="w-fit text-sm font-medium text-link hover:underline">
            View details
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
