import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ReportingCurrency, Severity, VerificationStatus, Warning } from '@wealthpilot/contracts';

import { formatDate, formatMonthYear, relativeDays } from '../lib/dates';
import { dec, formatRate } from '../lib/decimal';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH } from '../theme/tokens';
import { Money } from './Money';
import { Card, Icon, Row, Stack, Text, type IconName } from './primitives';

// ---------------------------------------------------------------------------
// ProvenancePill — verification / staleness / source, always icon + text (never color alone)
// ---------------------------------------------------------------------------

export function ProvenancePill({
  verification,
  stale,
  asOf,
  source,
  testID,
}: {
  verification?: VerificationStatus | null;
  stale?: boolean;
  asOf?: string | null;
  source?: string | null;
  testID?: string;
}) {
  const pills: { icon: IconName; text: string; kind: 'ok' | 'warn' | 'neutral' }[] = [];
  if (verification === 'verified') pills.push({ icon: 'checkmark-circle', text: 'Verified', kind: 'ok' });
  if (verification === 'estimated') pills.push({ icon: 'help-circle-outline', text: 'Estimated', kind: 'warn' });
  if (stale) pills.push({ icon: 'time-outline', text: asOf ? `Stale · ${formatDate(asOf)}` : 'Stale · no balance', kind: 'warn' });
  else if (asOf) pills.push({ icon: 'calendar-outline', text: `As of ${formatDate(asOf)}`, kind: 'neutral' });
  if (source) pills.push({ icon: 'create-outline', text: source === 'manual' ? 'Manual' : source, kind: 'neutral' });
  return (
    <Row wrap gap={6} style={s.pills}>
      {pills.map((p) => (
        <Pill key={p.text} icon={p.icon} text={p.text} kind={p.kind} testID={testID ? `${testID}-${p.kind}` : undefined} />
      ))}
    </Row>
  );
}

export function Pill({
  icon,
  text,
  kind = 'neutral',
  testID,
}: {
  icon?: IconName;
  text: string;
  kind?: 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';
  testID?: string;
}) {
  const t = useTheme();
  const map = {
    ok: { bg: t.colors.successBg, fg: t.colors.success },
    warn: { bg: t.colors.warningBg, fg: t.colors.warning },
    danger: { bg: t.colors.dangerBg, fg: t.colors.danger },
    neutral: { bg: t.colors.surfaceAlt, fg: t.colors.textMuted },
    accent: { bg: t.colors.surfaceAlt, fg: t.colors.primary },
  }[kind];
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={text}
      style={[s.pill, { backgroundColor: map.bg, borderColor: map.fg }, kind === 'warn' && s.dashed]}>
      {icon ? <Icon name={icon} size={14} color={map.fg} /> : null}
      <Text variant="caption" style={{ color: map.fg }}>
        {text}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ForecastLabels — required on every forecast card (spec §4.2)
// ---------------------------------------------------------------------------

export function ForecastLabels({
  asOf,
  scenario,
  assumptions,
  testID = 'forecast-labels',
}: {
  asOf: string | null | undefined;
  scenario: string | null | undefined;
  assumptions: string | null | undefined;
  testID?: string;
}) {
  return (
    <Row wrap gap={6} style={s.pills} testID={testID}>
      <Pill icon="calendar-outline" text={`As of ${asOf ? formatDate(asOf) : '—'}`} />
      <Pill icon="git-branch-outline" text={`Scenario: ${scenario ?? '—'}`} />
      <Pill icon="options-outline" text={`Assumptions: ${assumptions ?? '—'}`} />
      <Pill icon="flask-outline" text="Illustrative" kind="warn" />
    </Row>
  );
}

export function ForecastCard({
  title,
  asOf,
  scenario,
  assumptions,
  children,
  testID,
}: {
  title: string;
  asOf: string | null | undefined;
  scenario: string | null | undefined;
  assumptions: string | null | undefined;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <Card testID={testID}>
      <Text variant="heading">{title}</Text>
      <ForecastLabels asOf={asOf} scenario={scenario} assumptions={assumptions} />
      {children}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// BalanceCard
// ---------------------------------------------------------------------------

export function BalanceCard({
  title,
  amount,
  currency,
  asOf,
  subtitle,
  verification,
  stale,
  variant = 'display',
  children,
  testID,
}: {
  title: string;
  amount: string | null | undefined;
  currency: string;
  asOf?: string | null;
  subtitle?: string;
  verification?: VerificationStatus | null;
  stale?: boolean;
  variant?: 'display' | 'title' | 'heading';
  children?: ReactNode;
  testID?: string;
}) {
  const t = useTheme();
  const unconfirmed = verification === 'estimated' || stale;
  return (
    <Card
      testID={testID}
      style={unconfirmed ? [s.unconfirmed, { borderColor: t.colors.estimated }] : undefined}>
      <Text variant="label" tone="muted">
        {title}
      </Text>
      <Money
        value={amount}
        currency={currency}
        variant={variant}
        qualifier={[verification === 'estimated' ? 'estimated' : null, stale ? 'stale' : null].filter(Boolean).join(', ') || undefined}
      />
      {subtitle ? (
        <Text variant="caption" tone="muted">
          {subtitle}
        </Text>
      ) : null}
      {verification || stale || asOf ? <ProvenancePill verification={verification} stale={stale} asOf={asOf} /> : null}
      {children}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// CurrencyToggle — changes the display/reporting currency only; never touches balances
// ---------------------------------------------------------------------------

export function CurrencyToggle({
  value,
  onChange,
  testID = 'currency-toggle',
}: {
  value: ReportingCurrency;
  onChange: (c: ReportingCurrency) => void;
  testID?: string;
}) {
  const t = useTheme();
  const options: ReportingCurrency[] = ['USD', 'INR'];
  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel="Reporting currency"
      style={[s.toggle, { borderColor: t.colors.border, backgroundColor: t.colors.surfaceAlt }]}>
      {options.map((c) => {
        const selected = value === c;
        return (
          <Pressable
            key={c}
            testID={`${testID}-${c}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={c === 'USD' ? 'Show in US dollars' : 'Show in Indian rupees'}
            accessibilityHint="Changes the display currency only. Balances are not changed."
            onPress={() => onChange(c)}
            style={[s.toggleOpt, selected && { backgroundColor: t.colors.primary }]}>
            <Text variant="label" style={{ color: selected ? t.colors.onPrimary : t.colors.text }}>
              {c === 'USD' ? '$ USD' : '₹ INR'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// AssumptionRow
// ---------------------------------------------------------------------------

export function AssumptionRow({
  label,
  value,
  note,
  onExplain,
}: {
  label: string;
  value: string;
  note?: string;
  onExplain?: () => void;
}) {
  return (
    <Row style={s.assumption} gap={8}>
      <View style={s.flex}>
        <Text variant="label">{label}</Text>
        {note ? (
          <Text variant="caption" tone="muted">
            {note}
          </Text>
        ) : null}
      </View>
      <Text variant="bodyStrong" tabular>
        {value}
      </Text>
      {onExplain ? (
        <Pressable
          onPress={onExplain}
          accessibilityRole="button"
          accessibilityLabel={`Explain ${label}`}
          hitSlop={8}
          style={s.iconBtn}>
          <Icon name="information-circle-outline" />
        </Pressable>
      ) : null}
    </Row>
  );
}

// ---------------------------------------------------------------------------
// WarningPanel
// ---------------------------------------------------------------------------

const SEVERITY_META: Record<Severity, { icon: IconName; label: string; tone: 'danger' | 'warning' | 'info' }> = {
  critical: { icon: 'alert-circle', label: 'Critical', tone: 'danger' },
  warning: { icon: 'warning', label: 'Warning', tone: 'warning' },
  info: { icon: 'information-circle', label: 'Info', tone: 'info' },
};

export function WarningPanel({
  warnings,
  title = 'Warnings and caveats',
  testID = 'warning-panel',
}: {
  warnings: Warning[] | undefined | null;
  title?: string;
  testID?: string;
}) {
  const t = useTheme();
  if (!warnings || warnings.length === 0) return null;
  const order: Severity[] = ['critical', 'warning', 'info'];
  const sorted = [...warnings].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return (
    <Card testID={testID} tone={sorted[0]!.severity === 'critical' ? 'danger' : sorted[0]!.severity === 'warning' ? 'warning' : 'info'}>
      <Text variant="heading">{title}</Text>
      <Stack gap={10}>
        {sorted.map((w, i) => {
          const meta = SEVERITY_META[w.severity] ?? SEVERITY_META.info;
          const color = meta.tone === 'danger' ? t.colors.danger : meta.tone === 'warning' ? t.colors.warning : t.colors.info;
          return (
            <Row key={`${w.code}-${i}`} gap={8} style={s.warningRow}>
              <Icon name={meta.icon} color={color} />
              <View style={s.flex} accessible accessibilityLabel={`${meta.label}: ${w.message}`}>
                <Text variant="label" style={{ color }}>
                  {meta.label} · {humanizeCode(w.code)}
                </Text>
                <Text variant="body">{w.message}</Text>
              </View>
            </Row>
          );
        })}
      </Stack>
    </Card>
  );
}

export function humanizeCode(code: string): string {
  const s = code.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// RiskIndicator
// ---------------------------------------------------------------------------

export function RiskIndicator({ level, label, detail }: { level: 'low' | 'medium' | 'high'; label: string; detail?: string }) {
  const t = useTheme();
  const meta = {
    low: { icon: 'shield-checkmark-outline' as IconName, text: 'Low', color: t.colors.success, bars: 1 },
    medium: { icon: 'alert-outline' as IconName, text: 'Medium', color: t.colors.warning, bars: 2 },
    high: { icon: 'alert-circle-outline' as IconName, text: 'High', color: t.colors.danger, bars: 3 },
  }[level];
  return (
    <Row gap={10} style={s.assumption}>
      <Icon name={meta.icon} color={meta.color} />
      <View style={s.flex} accessible accessibilityLabel={`${label}: ${meta.text} risk${detail ? `. ${detail}` : ''}`}>
        <Text variant="label">{label}</Text>
        {detail ? (
          <Text variant="caption" tone="muted">
            {detail}
          </Text>
        ) : null}
      </View>
      <Row gap={3} importantForAccessibility="no-hide-descendants">
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            style={[s.riskBar, { height: 6 + i * 4, backgroundColor: i <= meta.bars ? meta.color : t.colors.border }]}
          />
        ))}
      </Row>
      <Text variant="label" style={{ color: meta.color }}>
        {meta.text}
      </Text>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// GoalProgress
// ---------------------------------------------------------------------------

export function GoalProgress({
  name,
  icon = 'flag-outline',
  pct,
  funded,
  target,
  currency,
  targetDate,
  illustrative,
  onPress,
  testID,
}: {
  name: string;
  icon?: IconName;
  pct: string | null | undefined;
  funded?: string | null;
  target?: string | null;
  currency: string;
  targetDate?: string | null;
  illustrative?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const t = useTheme();
  // `pct` is a fraction like every other ratio in the contract ("0.63" = 63%). See DECISIONS.md.
  const pctNum = pct == null ? null : dec(pct).times(100);
  const shown = pctNum === null ? '—' : `${pctNum.toDecimalPlaces(0).toFixed(0)}%`;
  const width = pctNum === null ? 0 : Math.max(0, Math.min(100, pctNum.toNumber()));
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${name}: ${shown} funded${targetDate ? `, target ${formatMonthYear(targetDate)}` : ''}${illustrative ? ', illustrative' : ''}`}
      style={s.goal}>
      <Row gap={8}>
        <Icon name={icon} color={t.colors.primary} />
        <Text variant="bodyStrong" style={s.flex}>
          {name}
          {targetDate ? ` · ${formatMonthYear(targetDate)}` : ''}
        </Text>
        <Text variant="bodyStrong" tabular>
          {shown} funded{illustrative ? '*' : ''}
        </Text>
      </Row>
      <View
        style={[s.track, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(width) }}>
        <View style={[s.fill, { width: `${width}%`, backgroundColor: t.colors.accent }]} />
      </View>
      {funded && target ? (
        <Row gap={4}>
          <Money value={funded} currency={currency} variant="caption" tone="muted" compact={false} />
          <Text variant="caption" tone="muted">
            of
          </Text>
          <Money value={target} currency={currency} variant="caption" tone="muted" compact={false} />
        </Row>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// VestTimeline
// ---------------------------------------------------------------------------

export interface VestTimelineItem {
  id: string;
  date: string;
  title: string;
  shares: string;
  status: 'scheduled' | 'vested' | 'cancelled';
  value?: string | null;
  currency?: string;
}

export function VestTimeline({
  items,
  onPressItem,
  today,
}: {
  items: VestTimelineItem[];
  onPressItem?: (id: string) => void;
  today?: string;
}) {
  const t = useTheme();
  const statusMeta = {
    scheduled: { icon: 'time-outline' as IconName, label: 'Scheduled', color: t.colors.info },
    vested: { icon: 'checkmark-circle' as IconName, label: 'Vested', color: t.colors.success },
    cancelled: { icon: 'close-circle-outline' as IconName, label: 'Cancelled', color: t.colors.textMuted },
  };
  return (
    <View accessibilityRole="list">
      {items.map((it, idx) => {
        const m = statusMeta[it.status];
        return (
          <Pressable
            key={it.id}
            onPress={onPressItem ? () => onPressItem(it.id) : undefined}
            disabled={!onPressItem}
            accessibilityRole={onPressItem ? 'button' : undefined}
            accessibilityLabel={`${it.title}, ${formatDate(it.date)}, ${it.shares} shares, ${m.label}`}
            style={s.vestRow}>
            <View style={s.vestRail}>
              <Icon name={m.icon} color={m.color} />
              {idx < items.length - 1 ? <View style={[s.vestLine, { backgroundColor: t.colors.border }]} /> : null}
            </View>
            <View style={[s.flex, s.vestBody]}>
              <Text variant="bodyStrong">{it.title}</Text>
              <Text variant="caption" tone="muted">
                {formatDate(it.date)} ({relativeDays(it.date, today)}) · {m.label}
              </Text>
              <Row gap={6}>
                <Text variant="body" tabular>
                  {dec(it.shares).toFixed()} shares
                </Text>
                {it.value && it.currency ? (
                  <>
                    <Text tone="muted">· est.</Text>
                    <Money value={it.value} currency={it.currency} variant="body" qualifier="estimated gross value" />
                  </>
                ) : null}
              </Row>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Row style={s.kv} gap={8}>
      <Text variant="label" tone="muted" style={s.flex}>
        {label}
      </Text>
      <View style={s.kvValue}>{typeof children === 'string' ? <Text tabular>{children}</Text> : children}</View>
    </Row>
  );
}

export function RateText({ value }: { value: string | null | undefined }) {
  return <Text tabular>{formatRate(value)}</Text>;
}

export function Disclaimer({ compact }: { compact?: boolean }) {
  return (
    <Card tone="info" accessibilityLabel="Disclaimer">
      <Row gap={8}>
        <Icon name="information-circle-outline" />
        <Text variant="caption" style={s.flex}>
          {compact
            ? 'Illustrative planning only — not tax, legal or investment advice.'
            : 'WealthPilot is planning software. Figures are illustrative and based on your own inputs and assumptions. It is not tax, legal or investment advice; verify important decisions with a qualified professional.'}
        </Text>
      </Row>
    </Card>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  pills: { marginVertical: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  dashed: { borderStyle: 'dashed' },
  unconfirmed: { borderStyle: 'dashed', borderWidth: 1.5 },
  toggle: { flexDirection: 'row', borderWidth: 1, borderRadius: 999, padding: 2 },
  toggleOpt: {
    minHeight: MIN_TOUCH - 4,
    minWidth: 64,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assumption: { minHeight: MIN_TOUCH, paddingVertical: 4 },
  iconBtn: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  warningRow: { alignItems: 'flex-start' },
  riskBar: { width: 6, borderRadius: 2, alignSelf: 'flex-end' },
  goal: { gap: 6, paddingVertical: 6 },
  track: { height: 12, borderRadius: 6, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  fill: { height: '100%' },
  vestRow: { flexDirection: 'row', gap: 10, minHeight: MIN_TOUCH },
  vestRail: { alignItems: 'center', width: 24 },
  vestLine: { width: 2, flex: 1, marginVertical: 2 },
  vestBody: { paddingBottom: 14, gap: 2 },
  kv: { minHeight: 32 },
  kvValue: { alignItems: 'flex-end', flexShrink: 1 },
});
