'use client';

import type { NetWorth, ReportingCurrency } from '@wealthpilot/contracts';
import {
  GOAL_ICONS,
  addDays,
  analytics,
  formatDate,
  formatMonthYear,
  relativeDays,
  todayIso,
} from '@wealthpilot/shared';
import { ArrowLeftRight, Calendar, CheckCircle2, CircleHelp, Clock, Plus, RefreshCw, Wallet } from 'lucide-react';
import Link from 'next/link';

import { EmptyState, LinkRow, PageHeader, QueryView } from '@/components/app';
import { ProjectionChart } from '@/components/charts';
import {
  CurrencyToggle,
  Disclaimer,
  FxProvenance,
  GoalProgress,
  ProvenancePill,
  WarningPanel,
} from '@/components/finance/finance';
import { Money } from '@/components/finance/Money';
import { CatalogIcon } from '@/components/icons';
import { Pill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDisplayCurrency, useGoals, useNetWorth, useNetWorthHistory, useVestCalendar } from '@/lib/hooks';
import { useUiStore } from '@/lib/store';
import { cn } from '@/lib/utils';

function isZero(v: string | null | undefined) {
  return !v || /^-?0+(\.0+)?$/.test(v);
}

/** S06 Overview (spec §17.1). */
export function OverviewPage() {
  const currency = useDisplayCurrency();
  const setDisplayCurrency = useUiStore((s) => s.setDisplayCurrency);
  const netWorth = useNetWorth(currency);
  const onToggle = (c: ReportingCurrency) => {
    // Only the reporting/display currency changes; balances are never modified (spec §4.2).
    setDisplayCurrency(c);
    analytics.track('currency_toggled', { currency: c });
  };
  return (
    <div data-testid="overview-screen">
      <PageHeader
        title="Household net worth"
        description="Everything you own and owe across the US and India, converted with your saved FX rate."
        actions={
          <>
            <CurrencyToggle value={currency} onChange={onToggle} />
            <Button asChild variant="outline">
              <Link href="/accounts/new">
                <Plus aria-hidden /> Add account
              </Link>
            </Button>
          </>
        }
      />
      <QueryView query={netWorth} loadingLabel="Loading net worth">
        {(nw) => <OverviewBody nw={nw} currency={currency} />}
      </QueryView>
    </div>
  );
}

function OverviewBody({ nw, currency }: { nw: NetWorth; currency: ReportingCurrency }) {
  const staleCount = nw.items.filter((i) => i.stale).length;
  const estimatedCount = nw.items.filter((i) => i.verification_status === 'estimated').length;
  const us = nw.by_country.find((c) => c.key === 'US')?.amount ?? '0';
  const india = nw.by_country.find((c) => c.key === 'IN')?.amount ?? '0';
  const inrNative = nw.by_currency.find((c) => c.key === 'INR')?.native_amount ?? null;
  const usdNative = nw.by_currency.find((c) => c.key === 'USD')?.native_amount ?? null;

  if (nw.items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={Wallet}
          title="Start with your accounts"
          body="Add cash, retirement, RSUs, EPF, FDs and debts in USD or INR. Manual entry — no bank logins."
          action={
            <Button asChild>
              <Link href="/accounts/new">
                <Plus aria-hidden /> Add your first account
              </Link>
            </Button>
          }
        />
        <WarningPanel warnings={nw.warnings} />
        <Disclaimer compact />
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className={cn('lg:col-span-2', estimatedCount + staleCount > 0 && 'border-dashed border-estimated')} data-testid="net-worth-card">
        <CardContent className="gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-muted-foreground">Net worth</p>
            <Money value={nw.net_worth} currency={currency} className="text-4xl font-semibold tracking-tight sm:text-5xl" testId="net-worth" />
            <p className="text-sm text-muted-foreground">As of {formatMonthYear(nw.as_of)} · gross assets minus liabilities</p>
          </div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Liquid</dt>
              <dd className="text-lg font-semibold">
                <Money value={nw.liquid_net_worth} currency={currency} testId="liquid-net-worth" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Goal-eligible</dt>
              <dd className="text-lg font-semibold">
                <Money value={nw.goal_eligible} currency={currency} testId="goal-eligible" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Data</dt>
              <dd>
                <Link
                  href="/accounts"
                  data-testid="stale-count"
                  className={cn(
                    'inline-flex items-center gap-1 text-lg font-semibold hover:underline',
                    staleCount ? 'text-warning-strong dark:text-warning' : 'text-success',
                  )}>
                  {staleCount ? <Clock className="size-4" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
                  {staleCount ? `${staleCount} stale` : 'Up to date'}
                </Link>
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-1.5">
            <Pill icon={<Calendar aria-hidden />}>As of {formatDate(nw.as_of)}</Pill>
            {estimatedCount ? (
              <Pill kind="warn" icon={<CircleHelp aria-hidden />} data-testid="estimated-count">
                {estimatedCount} estimated
              </Pill>
            ) : null}
            {staleCount ? (
              <Pill kind="warn" icon={<Clock aria-hidden />}>
                {staleCount} stale (&gt; 45 days)
              </Pill>
            ) : null}
          </div>
          {!isZero(nw.unvested_equity_excluded) ? (
            <p className="text-xs text-muted-foreground">
              Unvested equity excluded: <Money value={nw.unvested_equity_excluded} currency={currency} />
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card data-testid="country-split">
        <CardHeader>
          <CardTitle>US vs India</CardTitle>
        </CardHeader>
        <CardContent className="gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">US assets</p>
              <Money value={us} currency={currency} className="text-xl font-semibold" testId="us-assets" />
              {usdNative ? (
                <p className="text-xs text-muted-foreground">
                  Held in USD: <Money value={usdNative} currency="USD" compact={false} />
                </p>
              ) : null}
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">India assets</p>
              <Money value={india} currency={currency} className="text-xl font-semibold" testId="india-assets" />
              {inrNative ? (
                <p className="text-xs text-muted-foreground">
                  Held in INR: <Money value={inrNative} currency="INR" compact={false} />
                </p>
              ) : null}
            </div>
          </div>
          <FxProvenance rates={nw.fx} />
          <Button asChild variant="ghost" size="sm" className="w-fit">
            <Link href="/fx">
              <ArrowLeftRight aria-hidden /> FX assumptions
            </Link>
          </Button>
        </CardContent>
      </Card>

      <GoalsSection />
      <UpcomingSection nw={nw} />
      <Card data-testid="data-freshness">
        <CardHeader>
          <CardTitle>Data freshness</CardTitle>
        </CardHeader>
        <CardContent className="gap-1">
          {nw.items
            .filter((i) => i.stale || i.verification_status === 'estimated')
            .slice(0, 6)
            .map((i) => (
              <LinkRow
                key={i.ref_id}
                href={i.ref_type === 'account' ? `/accounts/${i.ref_id}` : `/rsu/${i.ref_id}`}
                icon={i.stale ? Clock : CircleHelp}
                title={i.name}
                right={<ProvenancePill verification={i.verification_status} stale={i.stale} />}
              />
            ))}
          {staleCount === 0 && estimatedCount === 0 ? (
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-success" aria-hidden /> All balances are verified and updated within 45 days.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="lg:col-span-3">
        <WarningPanel warnings={nw.warnings} />
      </div>
      <HistorySection currency={currency} />
      <Disclaimer compact className="lg:col-span-3" />
    </div>
  );
}

function GoalsSection() {
  const goals = useGoals();
  const items = goals.data?.items ?? [];
  return (
    <Card data-testid="goals-section">
      <CardHeader className="justify-between">
        <CardTitle>Your goals</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href="/goals">All goals</Link>
        </Button>
      </CardHeader>
      <CardContent className="gap-1">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No goals yet.{' '}
            <Link href="/goals/new" className="text-link underline">
              Create a home or retirement goal
            </Link>
            .
          </p>
        ) : (
          items.slice(0, 4).map((g) => (
            <GoalProgress
              key={g.id}
              name={g.name}
              icon={<CatalogIcon name={GOAL_ICONS[g.type]} className="size-4" />}
              pct={g.progress?.pct}
              funded={g.progress?.funded_amount}
              target={g.target_amount}
              currency={g.currency}
              targetDate={g.target_date}
              illustrative={!!g.progress?.scenario_run_id}
              href={`/goals/${g.id}`}
            />
          ))
        )}
        {items.some((g) => g.progress?.scenario_run_id) ? (
          <p className="text-xs text-muted-foreground">* Illustrative, based on saved scenario assumptions.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function UpcomingSection({ nw }: { nw: NetWorth }) {
  const today = todayIso();
  const cal = useVestCalendar(today, addDays(today, 60));
  const vests = (cal.data?.items ?? []).filter((v) => v.status === 'scheduled').slice(0, 3);
  const stale = nw.items.filter((i) => i.stale).slice(0, 3);
  return (
    <Card data-testid="upcoming-section">
      <CardHeader className="justify-between">
        <CardTitle>Upcoming</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href="/rsu/calendar">Vest calendar</Link>
        </Button>
      </CardHeader>
      <CardContent className="gap-1">
        {vests.length === 0 && stale.length === 0 ? <p className="text-sm text-muted-foreground">Nothing due in the next 60 days.</p> : null}
        {vests.map((v) => (
          <LinkRow
            key={v.vest_id}
            href={`/rsu/${v.grant_id}`}
            icon={Calendar}
            title={`RSU vest ${relativeDays(v.vest_date, today)}`}
            subtitle={`${v.symbol} · ${formatDate(v.vest_date)}`}
          />
        ))}
        {stale.map((i) => (
          <LinkRow
            key={i.ref_id}
            href={i.ref_type === 'account' ? `/accounts/${i.ref_id}` : `/rsu/${i.ref_id}`}
            icon={RefreshCw}
            title={`Update ${i.name} balance`}
            subtitle={i.as_of ? `Last updated ${formatDate(i.as_of)}` : 'No balance yet'}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function HistorySection({ currency }: { currency: ReportingCurrency }) {
  const hist = useNetWorthHistory(currency, 12);
  const items = hist.data?.items ?? [];
  if (items.length < 2) return null;
  return (
    <Card className="lg:col-span-3">
      <CardContent>
        <ProjectionChart
          title="Net worth history (month-end, recorded balances)"
          xLabels={items.map((i) => formatMonthYear(i.as_of))}
          series={[
            { key: 'nw', label: 'Net worth', values: items.map((i) => i.net_worth) },
            { key: 'liquid', label: 'Liquid', values: items.map((i) => i.liquid_net_worth) },
          ]}
          currency={currency}
          testId="history-chart"
        />
      </CardContent>
    </Card>
  );
}
