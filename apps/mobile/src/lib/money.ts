/**
 * Money formatting (spec §4.2): USD as $1,234,567.89 and INR with Indian grouping ₹12,34,567.89 (en-IN).
 * Optional lakh/crore (INR) and K/M/B (USD) short forms are always flagged as approximate.
 *
 * Implemented without Intl or floats so decimal strings of any size format exactly and identically on
 * Hermes, JSC and web.
 */
import { D, toDec, type Dec } from './decimal';

export type SupportedCurrency = 'USD' | 'INR';

const SYMBOLS: Record<string, string> = { USD: '$', INR: '₹' };
const NAMES: Record<string, [string, string]> = {
  USD: ['US dollar', 'US dollars'],
  INR: ['Indian rupee', 'Indian rupees'],
};

export interface FormatMoneyOptions {
  /** Decimal places (default 2). */
  decimals?: number;
  /** Prefix positive values with "+". */
  signed?: boolean;
}

/** Group integer digits: western (3s) or Indian (last 3, then 2s). */
export function groupDigits(intDigits: string, style: 'western' | 'indian'): string {
  const digits = intDigits.replace(/^0+(?=\d)/, '');
  if (style === 'western') return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

export function groupingFor(currency: string): 'western' | 'indian' {
  return currency === 'INR' ? 'indian' : 'western';
}

export function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? `${currency} `;
}

/** Format a plain decimal number with grouping (no currency symbol). */
export function formatNumber(
  value: string | number | Dec | null | undefined,
  { decimals = 2, grouping = 'western' as 'western' | 'indian' } = {},
): string {
  const d = toDec(value as string);
  if (!d) return '—';
  const fixed = d.abs().toFixed(decimals, D.ROUND_HALF_UP);
  const [int = '0', frac] = fixed.split('.');
  const neg = d.isNeg() && !new D(fixed).isZero();
  return `${neg ? '-' : ''}${groupDigits(int, grouping)}${frac ? `.${frac}` : ''}`;
}

/**
 * Full-precision display: "$1,234,567.89", "₹12,34,567.89", "-$5.00".
 * Returns "—" for missing/invalid values (never "0", which would fabricate a balance).
 */
export function formatMoney(
  value: string | number | Dec | null | undefined,
  currency: string,
  opts: FormatMoneyOptions = {},
): string {
  const d = toDec(value as string);
  if (!d) return '—';
  const decimals = opts.decimals ?? 2;
  const fixed = d.abs().toFixed(decimals, D.ROUND_HALF_UP);
  const isZero = new D(fixed).isZero();
  const [int = '0', frac] = fixed.split('.');
  const body = `${currencySymbol(currency)}${groupDigits(int, groupingFor(currency))}${frac ? `.${frac}` : ''}`;
  if (d.isNeg() && !isZero) return `-${body}`;
  if (opts.signed && !isZero) return `+${body}`;
  return body;
}

export interface CompactMoney {
  /** e.g. "₹12.35 L", "₹1.23 Cr", "$1.23M" */
  text: string;
  /** Always true: short forms are rounded. */
  approximate: true;
  /** Screen-reader friendly: "approximately 12.35 lakh Indian rupees". */
  spoken: string;
}

/**
 * Short form. INR uses lakh (1,00,000) and crore (1,00,00,000); USD uses K/M/B.
 * Values below the first unit fall back to the full grouped value (still marked approximate because of
 * rounding to whole units).
 */
export function formatMoneyCompact(value: string | number | Dec | null | undefined, currency: string): CompactMoney | null {
  const d = toDec(value as string);
  if (!d) return null;
  const sym = currencySymbol(currency);
  const abs = d.abs();
  const sign = d.isNeg() ? '-' : '';
  const name = NAMES[currency]?.[1] ?? currency;
  const units: { size: Dec; short: string; word: string }[] =
    currency === 'INR'
      ? [
          { size: new D('10000000'), short: 'Cr', word: 'crore' },
          { size: new D('100000'), short: 'L', word: 'lakh' },
        ]
      : [
          { size: new D('1000000000'), short: 'B', word: 'billion' },
          { size: new D('1000000'), short: 'M', word: 'million' },
          { size: new D('1000'), short: 'K', word: 'thousand' },
        ];
  for (const u of units) {
    if (abs.gte(u.size)) {
      const n = abs.dividedBy(u.size).toDecimalPlaces(2, D.ROUND_HALF_UP);
      const num = trim(n.toFixed(2));
      const sep = currency === 'INR' ? ' ' : '';
      return {
        text: `${sign}${sym}${num}${sep}${u.short}`,
        approximate: true,
        spoken: `approximately ${sign ? 'minus ' : ''}${num} ${u.word} ${name}`,
      };
    }
  }
  const whole = abs.toDecimalPlaces(0, D.ROUND_HALF_UP).toFixed(0);
  return {
    text: `${sign}${sym}${groupDigits(whole, groupingFor(currency))}`,
    approximate: true,
    spoken: `approximately ${sign ? 'minus ' : ''}${whole} ${name}`,
  };
}

function trim(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Accessible label: "1,234,567.89 US dollars" / "minus 5.00 US dollars". */
export function moneyAccessibilityLabel(value: string | number | Dec | null | undefined, currency: string): string {
  const d = toDec(value as string);
  if (!d) return 'Not available';
  const n = formatNumber(d.abs(), { decimals: 2, grouping: groupingFor(currency) });
  const [singular, plural] = NAMES[currency] ?? [currency, currency];
  const unit = d.abs().eq(1) ? singular : plural;
  return `${d.isNeg() ? 'minus ' : ''}${n} ${unit}`;
}

/** Parse a user-entered amount ("1,23,456.70", "$1,234", "₹ 5") into a decimal string, or null. */
export function parseMoneyInput(input: string): string | null {
  const cleaned = input.replace(/[\s,$₹]/g, '').replace(/^\+/, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const d = toDec(cleaned);
  return d ? d.toFixed() : null;
}
