import { StyleSheet, View } from 'react-native';

import { formatMoney, formatMoneyCompact, moneyAccessibilityLabel } from '../lib/money';
import { useUiStore } from '../store/ui';
import type { TypographyVariant } from '../theme/tokens';
import { Text, type Tone } from './primitives';

export interface MoneyProps {
  value: string | null | undefined;
  currency: string;
  variant?: TypographyVariant;
  tone?: Tone;
  /** Force (true/false) the lakh/crore/K/M approximation; defaults to the session preference. */
  compact?: boolean;
  signed?: boolean;
  /** Extra screen-reader context, e.g. "estimated". */
  qualifier?: string;
  testID?: string;
  strike?: boolean;
}

/**
 * Formats a decimal-string amount exactly. USD: $1,234,567.89. INR: ₹12,34,567.89 (Indian grouping).
 * When compact is on, the short form is shown *alongside* a "≈" marker so it is never mistaken for an
 * exact figure (spec §4.2: never confuse lakh/crore notation with numeric precision).
 */
export function Money({ value, currency, variant = 'body', tone, compact, signed, qualifier, testID, strike }: MoneyProps) {
  const pref = useUiStore((s) => s.compactAmounts);
  const useCompact = compact ?? pref;
  const full = formatMoney(value, currency, { signed });
  const short = useCompact ? formatMoneyCompact(value, currency) : null;
  const label = `${short ? short.spoken : moneyAccessibilityLabel(value, currency)}${qualifier ? `, ${qualifier}` : ''}`;
  if (short) {
    return (
      <View style={s.wrap} accessible accessibilityLabel={label} testID={testID}>
        <Text variant={variant} tone={tone} tabular style={strike && s.strike}>
          ≈ {short.text}
        </Text>
        <Text variant="caption" tone="muted" tabular>
          {full} · approximate
        </Text>
      </View>
    );
  }
  return (
    <Text
      variant={variant}
      tone={tone}
      tabular
      accessibilityLabel={label}
      testID={testID}
      style={strike && s.strike}>
      {full}
    </Text>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 0 },
  strike: { textDecorationLine: 'line-through' },
});
