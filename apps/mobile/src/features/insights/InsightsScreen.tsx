import { router } from 'expo-router';
import { View } from 'react-native';

import type { Insight, NetWorth, Severity } from '@wealthpilot/contracts';

import { QueryView } from '@/components/app';
import { CurrencyToggle, Disclaimer, Pill, RiskIndicator } from '@/components/finance';
import { Money } from '@/components/Money';
import { Card, EmptyState, Icon, Row, Screen, SectionHeader, Stack, Text, type IconName } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import { formatDate } from '@/lib/dates';
import { dec } from '@/lib/decimal';
import { useDisplayCurrency, useInsights, useNetWorth } from '@/lib/hooks';
import { useUiStore } from '@/store/ui';
import { useTheme } from '@/theme/ThemeProvider';

const SEVERITY_META: Record<Severity, { icon: IconName; label: string; tone: 'muted' | 'warning' | 'danger' }> = {
  info: { icon: 'information-circle-outline', label: 'Info', tone: 'muted' },
  warning: { icon: 'warning-outline', label: 'Warning', tone: 'warning' },
  critical: { icon: 'alert-circle-outline', label: 'Important', tone: 'danger' },
};

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Share of `part` in `whole` as a fraction string (0..1), or null if undefined. Decimal arithmetic only. */
export function shareOf(part: string | null | undefined, whole: string | null | undefined): string | null {
  if (part == null || whole == null) return null;
  const w = dec(whole);
  if (w.lte(0)) return null;
  return dec(part).div(w).toFixed(4);
}

function pct(fraction: string): string {
  return `${dec(fraction).times(100).toDecimalPlaces(1).toString()}%`;
}

/** Deterministic thresholds for the risk indicators; documented beside the indicator. */
export function riskLevel(fraction: string, medium: string, high: string): 'low' | 'medium' | 'high' {
  const f = dec(fraction);
  if (f.gte(high)) return 'high';
  if (f.gte(medium)) return 'medium';
  return 'low';
}

/** S19 Insights: deterministic insights from the API plus exposure indicators from the net-worth breakdown. */
export default function InsightsScreen() {
  const currency = useDisplayCurrency();
  const setDisplayCurrency = useUiStore((s) => s.setDisplayCurrency);
  const insights = useInsights(currency);
  const netWorth = useNetWorth(currency);

  return (
    <Screen testID="insights-screen">
      <Row>
        <Text variant="title" style={{ flex: 1 }}>
          Insights
        </Text>
        <CurrencyToggle
          value={currency}
          onChange={(c) => {
            setDisplayCurrency(c);
            analytics.track('currency_toggled', { currency: c, screen: 'insights' });
          }}
        />
      </Row>
      <Text tone="muted">
        Rule-based observations about your own data. They are not recommendations to buy, sell or move money.
      </Text>

      <QueryView query={netWorth} loadingLabel="Loading exposure">
        {(nw) => <Exposure nw={nw} />}
      </QueryView>

      <SectionHeader title="Observations" />
      <QueryView query={insights} loadingLabel="Loading insights">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              icon="checkmark-circle-outline"
              title="Nothing to flag right now"
              body="Insights appear as you add accounts, RSU grants and goals."
            />
          ) : (
            <Stack gap={10}>
              {[...data.items]
                .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
                .map((i, idx) => (
                  <InsightCard key={`${i.code}-${idx}`} insight={i} />
                ))}
            </Stack>
          )
        }
      </QueryView>
      <Disclaimer compact />
    </Screen>
  );
}

function Exposure({ nw }: { nw: NetWorth }) {
  const t = useTheme();
  const inr = nw.by_currency.find((c) => c.key === 'INR');
  const inrShare = shareOf(inr?.amount ?? '0', nw.gross_assets);
  const liquidShare = shareOf(nw.liquid_net_worth, nw.net_worth);
  const largest = [...nw.items]
    .filter((i) => i.kind === 'asset')
    .sort((a, b) => dec(b.amount).comparedTo(dec(a.amount)))[0];
  const largestShare = largest ? shareOf(largest.amount, nw.gross_assets) : null;
  // Impact of a 10% move in INR on the reporting-currency value of INR holdings (illustrative).
  const inrMove = inr ? dec(inr.amount).times('0.10').toFixed(2) : null;

  return (
    <Card testID="exposure-card">
      <Text variant="heading">Exposure</Text>
      <Text variant="caption" tone="muted">
        As of {formatDate(nw.as_of)} · in {nw.currency} · thresholds: medium ≥ 25%, high ≥ 50%
      </Text>
      {largest && largestShare ? (
        <RiskIndicator
          level={riskLevel(largestShare, '0.25', '0.5')}
          label="Largest single holding"
          detail={`${largest.name} is ${pct(largestShare)} of gross assets`}
        />
      ) : null}
      {inrShare ? (
        <RiskIndicator
          level={riskLevel(inrShare, '0.25', '0.5')}
          label="INR currency exposure"
          detail={`${pct(inrShare)} of gross assets is held in INR`}
        />
      ) : null}
      {liquidShare ? (
        <RiskIndicator
          level={dec(liquidShare).lt('0.1') ? 'high' : dec(liquidShare).lt('0.25') ? 'medium' : 'low'}
          label="Low liquidity"
          detail={`${pct(liquidShare)} of net worth is liquid (medium < 25%, high < 10%)`}
        />
      ) : null}
      {inrMove && dec(inrMove).gt(0) ? (
        <View testID="inr-move" style={{ gap: 4 }}>
          <Row gap={6} wrap>
            <Text variant="caption">A 10% move in USD/INR changes the {nw.currency} value of your INR holdings by about</Text>
            <Money value={inrMove} currency={nw.currency} variant="caption" compact={false} />
          </Row>
          <Text variant="caption" tone="muted">
            Illustrative sensitivity, not a forecast.
          </Text>
        </View>
      ) : null}
      {dec(nw.unvested_equity_excluded).gt(0) ? (
        <Row gap={6} wrap>
          <Icon name="lock-closed-outline" color={t.colors.textMuted} />
          <Text variant="caption" tone="muted">
            Unvested equity excluded from net worth:
          </Text>
          <Money value={nw.unvested_equity_excluded} currency={nw.currency} variant="caption" compact={false} />
        </Row>
      ) : null}
    </Card>
  );
}

function InsightCard({ insight: i }: { insight: Insight }) {
  const meta = SEVERITY_META[i.severity] ?? SEVERITY_META.info;
  const t = useTheme();
  const color = meta.tone === 'danger' ? t.colors.danger : meta.tone === 'warning' ? t.colors.warning : t.colors.textMuted;
  const ref = i.refs[0];
  const open = ref
    ? () => {
        if (ref.ref_type === 'account') router.push({ pathname: '/accounts/[id]', params: { id: ref.ref_id } });
        else if (ref.ref_type === 'rsu_grant') router.push({ pathname: '/rsu/[id]', params: { id: ref.ref_id } });
        else if (ref.ref_type === 'goal') router.push({ pathname: '/goals/[id]', params: { id: ref.ref_id } });
      }
    : undefined;
  return (
    <Card
      tone={i.severity === 'critical' ? 'danger' : i.severity === 'warning' ? 'warning' : 'default'}
      testID={`insight-${i.code}`}
      accessibilityLabel={`${meta.label}: ${i.title}. ${i.body}`}>
      <Row gap={8}>
        <Icon name={meta.icon} color={color} />
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {i.title}
        </Text>
        <Pill text={meta.label} icon={meta.icon} />
      </Row>
      <Text>{i.body}</Text>
      {open ? (
        <Text tone="link" accessibilityRole="link" onPress={open}>
          View details
        </Text>
      ) : null}
    </Card>
  );
}
