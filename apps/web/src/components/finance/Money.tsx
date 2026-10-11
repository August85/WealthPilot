'use client';

import { formatMoney, formatMoneyCompact, moneyAccessibilityLabel } from '@wealthpilot/shared';

import { useUiStore } from '@/lib/store';
import { cn } from '@/lib/utils';

export interface MoneyProps {
  value: string | null | undefined;
  currency: string;
  className?: string;
  /** Force (true/false) the lakh/crore/K/M approximation; defaults to the viewer preference. */
  compact?: boolean;
  signed?: boolean;
  /** Extra screen-reader context, e.g. "estimated". */
  qualifier?: string;
  strike?: boolean;
  testId?: string;
}

/**
 * Formats a decimal-string amount exactly: USD $1,234,567.89, INR ₹12,34,567.89 (Indian grouping).
 * When short amounts are on, the short form is prefixed with "≈" and the exact figure stays visible beside it,
 * labelled approximate (spec §4.2: never confuse lakh/crore notation with numeric precision).
 */
export function Money({ value, currency, className, compact, signed, qualifier, strike, testId }: MoneyProps) {
  const pref = useUiStore((s) => s.compactAmounts);
  const useCompact = compact ?? pref;
  const full = formatMoney(value, currency, { signed });
  const short = useCompact ? formatMoneyCompact(value, currency) : null;
  const spoken = `${short ? short.spoken : moneyAccessibilityLabel(value, currency)}${qualifier ? `, ${qualifier}` : ''}`;
  if (short) {
    return (
      <span className={cn('inline-flex flex-col', className)} data-testid={testId} title={`${full} (approximate short form shown)`}>
        <span aria-hidden className={cn('tabular', strike && 'line-through')}>
          ≈ {short.text}
        </span>
        <span aria-hidden className="tabular text-xs font-normal text-muted-foreground">
          {full} · approximate
        </span>
        <span className="sr-only">{spoken}</span>
      </span>
    );
  }
  return (
    <span className={cn('tabular', strike && 'line-through', className)} data-testid={testId} title={qualifier ? `${full} (${qualifier})` : undefined}>
      {full}
      {qualifier ? <span className="sr-only">, {qualifier}</span> : null}
    </span>
  );
}
