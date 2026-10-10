import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { NetWorth, ReportingCurrency } from '@wealthpilot/contracts';

import { QueryView } from '@/components/app';
import { ProjectionChart } from '@/components/charts';
import {
  BalanceCard,
  CurrencyToggle,
  Disclaimer,
  GoalProgress,
  Pill,
  ProvenancePill,
  WarningPanel,
} from '@/components/finance';
import { FxProvenance } from '@/components/FxProvenance';
import { Money } from '@/components/Money';
import { Button, Card, EmptyState, Icon, LinkRow, Row, Screen, SectionHeader, Stack, Text } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import { GOAL_ICONS } from '@/lib/catalog';
import { addDays, formatDate, formatMonthYear, relativeDays, todayIso } from '@/lib/dates';
import { useDisplayCurrency, useGoals, useNetWorth, useNetWorthHistory, useVestCalendar } from '@/lib/hooks';
import { useUiStore } from '@/store/ui';
import { useTheme } from '@/theme/ThemeProvider';

/** S06 Overview — matches the spec §17.1 wireframe. */
export default function OverviewScreen() {
  const currency = useDisplayCurrency();
  const setDisplayCurrency = useUiStore((s) => s.setDisplayCurrency);
  const netWorth = useNetWorth(currency);

  const onToggle = (c: ReportingCurrency) => {
    // Only the reporting/display currency changes; balances are never modified (spec §4.2).
    setDisplayCurrency(c);
    analytics.track('currency_toggled', { currency: c });
  };

  return (
    <Screen testID="overview-screen">
      <Row>
        <Text variant="heading" style={styles.flex}>
          Household net worth
        </Text>
        <CurrencyToggle value={currency} onChange={onToggle} />
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={8}
          style={styles.iconBtn}>
          <Icon name="settings-outline" />
        </Pressable>
      </Row>
      <QueryView query={netWorth} loadingLabel="Loading net worth">
        {(nw) => <OverviewBody nw={nw} currency={currency} />}
      </QueryView>
    </Screen>
  );
}

function OverviewBody({ nw, currency }: { nw: NetWorth; currency: ReportingCurrency }) {
  const t = useTheme();
  const staleCount = nw.items.filter((i) => i.stale).length;
  const estimatedCount = nw.items.filter((i) => i.verification_status === 'estimated').length;
  const us = nw.by_country.find((c) => c.key === 'US')?.amount ?? '0';
  const india = nw.by_country.find((c) => c.key === 'IN')?.amount ?? '0';
  const inrNative = nw.by_currency.find((c) => c.key === 'INR')?.native_amount ?? null;
  const usdNative = nw.by_currency.find((c) => c.key === 'USD')?.native_amount ?? null;

  if (nw.items.length === 0) {
    return (
      <Stack gap={16}>
        <EmptyState
          icon="wallet-outline"
          title="Start with your accounts"
          body="Add cash, retirement, RSUs, EPF, FDs and debts in USD or INR. Manual entry — no bank logins."
          actionLabel="Add your first account"
          onAction={() => router.push('/accounts/new')}
        />
        <WarningPanel warnings={nw.warnings} />
        <Disclaimer compact />
      </Stack>
    );
  }

  return (
    <Stack gap={16}>
      <BalanceCard
        testID="net-worth-card"
        title="Net worth"
        amount={nw.net_worth}
        currency={currency}
        subtitle={`As of ${formatMonthYear(nw.as_of)} · gross assets minus liabilities`}>
        <Row wrap gap={16}>
          <View>
            <Text variant="caption" tone="muted">
              Liquid
            </Text>
            <Money value={nw.liquid_net_worth} currency={currency} variant="bodyStrong" testID="liquid-net-worth" />
          </View>
          <View>
            <Text variant="caption" tone="muted">
              Goal-eligible
            </Text>
            <Money value={nw.goal_eligible} currency={currency} variant="bodyStrong" />
          </View>
          <Pressable
            onPress={() => router.push('/accounts')}
            accessibilityRole="button"
            accessibilityLabel={`Data freshness: ${staleCount} stale, ${estimatedCount} estimated. Open accounts.`}>
            <Text variant="caption" tone="muted">
              Data
            </Text>
            <Text variant="bodyStrong" tone={staleCount ? 'warning' : 'default'} testID="stale-count">
              {staleCount ? `⏱ ${staleCount} stale` : '✓ up to date'}
            </Text>
          </Pressable>
        </Row>
        <Row wrap gap={6}>
          <Pill icon="calendar-outline" text={`As of ${formatDate(nw.as_of)}`} />
          {estimatedCount ? <Pill icon="help-circle-outline" text={`${estimatedCount} estimated`} kind="warn" /> : null}
        </Row>
        {nw.unvested_equity_excluded && nw.unvested_equity_excluded !== '0' && nw.unvested_equity_excluded !== '0.00' ? (
          <Row gap={4} wrap>
            <Text variant="caption" tone="muted">
              Unvested equity excluded:
            </Text>
            <Money value={nw.unvested_equity_excluded} currency={currency} variant="caption" tone="muted" />
          </Row>
        ) : null}
      </BalanceCard>

      <Card testID="country-split">
        <Text variant="heading">US vs India</Text>
        <Row gap={12} style={styles.split}>
          <View style={styles.flex} accessible accessibilityLabel="US assets">
            <Text variant="label" tone="muted">
              🇺🇸 US assets
            </Text>
            <Money value={us} currency={currency} variant="heading" />
            {usdNative ? (
              <Text variant="caption" tone="muted">
                Held in USD: <Money value={usdNative} currency="USD" variant="caption" tone="muted" compact={false} />
              </Text>
            ) : null}
          </View>
          <View style={styles.flex} accessible accessibilityLabel="India assets">
            <Text variant="label" tone="muted">
              🇮🇳 India assets
            </Text>
            <Money value={india} currency={currency} variant="heading" />
            {inrNative ? (
              <Text variant="caption" tone="muted">
                Held in INR: <Money value={inrNative} currency="INR" variant="caption" tone="muted" compact={false} />
              </Text>
            ) : null}
          </View>
        </Row>
        <FxProvenance rates={nw.fx} />
        <Button compact variant="ghost" icon="swap-horizontal" label="FX assumptions" onPress={() => router.push('/fx')} />
      </Card>

      <GoalsSection />
      <UpcomingSection nw={nw} />

      <Card testID="data-freshness">
        <Text variant="heading">Data freshness</Text>
        {nw.items
          .filter((i) => i.stale || i.verification_status === 'estimated')
          .slice(0, 6)
          .map((i) => (
            <LinkRow
              key={i.ref_id}
              title={i.name}
              icon={i.stale ? 'time-outline' : 'help-circle-outline'}
              onPress={() => router.push(i.ref_type === 'account' ? `/accounts/${i.ref_id}` : `/rsu/${i.ref_id}`)}
              right={<ProvenancePill verification={i.verification_status} stale={i.stale} asOf={i.as_of} />}
              accessibilityHint="Opens the item to update its balance"
            />
          ))}
        {staleCount === 0 && estimatedCount === 0 ? (
          <Row gap={6}>
            <Icon name="checkmark-circle" color={t.colors.success} />
            <Text>All balances are verified and updated within 45 days.</Text>
          </Row>
        ) : null}
      </Card>

      <WarningPanel warnings={nw.warnings} />
      <HistorySection currency={currency} />
      <Disclaimer compact />
    </Stack>
  );
}

function GoalsSection() {
  const goals = useGoals();
  const items = goals.data?.items ?? [];
  return (
    <Card testID="goals-section">
      <SectionHeader
        title="Your goals"
        action={<Button compact variant="ghost" label="Plan" onPress={() => router.push('/plan')} />}
      />
      {items.length === 0 ? (
        <Text tone="muted">No goals yet. Create a home or retirement goal in Plan.</Text>
      ) : (
        items.slice(0, 4).map((g) => (
          <GoalProgress
            key={g.id}
            name={g.name}
            icon={GOAL_ICONS[g.type]}
            pct={g.progress?.pct}
            funded={g.progress?.funded_amount}
            target={g.target_amount}
            currency={g.currency}
            targetDate={g.target_date}
            illustrative={!!g.progress?.scenario_run_id}
            onPress={() => router.push(`/goals/${g.id}`)}
          />
        ))
      )}
      {items.some((g) => g.progress?.scenario_run_id) ? (
        <Text variant="caption" tone="muted">
          * Illustrative, based on saved scenario assumptions.
        </Text>
      ) : null}
    </Card>
  );
}

function UpcomingSection({ nw }: { nw: NetWorth }) {
  const today = todayIso();
  const cal = useVestCalendar(today, addDays(today, 60));
  const vests = (cal.data?.items ?? []).filter((v) => v.status === 'scheduled').slice(0, 3);
  const stale = nw.items.filter((i) => i.stale).slice(0, 3);
  return (
    <Card testID="upcoming-section">
      <SectionHeader
        title="Upcoming"
        action={<Button compact variant="ghost" label="Vest calendar" onPress={() => router.push('/rsu/calendar')} />}
      />
      {vests.length === 0 && stale.length === 0 ? <Text tone="muted">Nothing due in the next 60 days.</Text> : null}
      {vests.map((v) => (
        <LinkRow
          key={v.vest_id}
          icon="calendar-outline"
          title={`RSU vest ${relativeDays(v.vest_date, today)}`}
          subtitle={`${v.symbol} · ${formatDate(v.vest_date)}`}
          onPress={() => router.push(`/rsu/${v.grant_id}`)}
        />
      ))}
      {stale.map((i) => (
        <LinkRow
          key={i.ref_id}
          icon="refresh-outline"
          title={`Update ${i.name} balance`}
          subtitle={i.as_of ? `Last updated ${formatDate(i.as_of)}` : 'No balance yet'}
          onPress={() => router.push(i.ref_type === 'account' ? `/accounts/${i.ref_id}` : `/rsu/${i.ref_id}`)}
        />
      ))}
    </Card>
  );
}

function HistorySection({ currency }: { currency: ReportingCurrency }) {
  const hist = useNetWorthHistory(currency, 12);
  const items = hist.data?.items ?? [];
  if (items.length < 2) return null;
  return (
    <Card>
      <ProjectionChart
        title="Net worth history (month-end, recorded balances)"
        xLabels={items.map((i) => formatMonthYear(i.as_of))}
        series={[
          { key: 'nw', label: 'Net worth', values: items.map((i) => i.net_worth) },
          { key: 'liquid', label: 'Liquid', values: items.map((i) => i.liquid_net_worth) },
        ]}
        currency={currency}
        testID="history-chart"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  iconBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  split: { alignItems: 'flex-start' },
});
