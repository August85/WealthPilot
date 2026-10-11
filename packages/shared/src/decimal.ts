/**
 * Decimal helpers. All money/quantity math on the client goes through decimal.js — never JS floats.
 * The API is authoritative (spec §6); client math is only for previews and display.
 */
import { Decimal } from 'decimal.js';

/** A dedicated Decimal constructor so global config changes elsewhere cannot affect money math. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export function toDec(v: string | number | Dec | null | undefined): Dec | null {
  if (v === null || v === undefined || v === '') return null;
  try {
    const d = new D(v as Decimal.Value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** Parse, defaulting to zero. */
export function dec(v: string | number | Dec | null | undefined): Dec {
  return toDec(v) ?? new D(0);
}

export function isDecimalString(v: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(v.trim());
}

export function sumDec(values: (string | null | undefined)[]): Dec {
  return values.reduce<Dec>((acc, v) => acc.plus(dec(v)), new D(0));
}

/** Format a fractional rate string ("0.0625") as a percentage ("6.25%"). */
export function formatRate(v: string | null | undefined, dp = 2): string {
  const d = toDec(v);
  if (!d) return '—';
  const pct = d.times(100).toDecimalPlaces(dp);
  return `${trimZeros(pct.toFixed(dp))}%`;
}

/** Convert a user-typed percentage ("6.25") to a fraction string ("0.0625"). */
export function percentToFraction(v: string): string {
  const d = toDec(v.replace('%', '').trim());
  if (!d) return '';
  return trimZeros(d.dividedBy(100).toFixed(8));
}

/** Convert a fraction string ("0.0625") to a percentage string ("6.25") for editing. */
export function fractionToPercent(v: string | null | undefined): string {
  const d = toDec(v);
  if (!d) return '';
  return trimZeros(d.times(100).toFixed(6));
}

export function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

/**
 * Monthly principal & interest (spec §6.2): P × r × (1+r)^n / ((1+r)^n − 1); r=0 → P/n.
 * Client-side preview only; the run result from the API is what the app shows as the answer.
 */
export function mortgagePayment(principal: string, annualRate: string, termYears: number): Dec {
  const P = dec(principal);
  const n = new D(termYears).times(12);
  if (n.lte(0)) return new D(0);
  const r = dec(annualRate).dividedBy(12);
  if (r.isZero()) return P.dividedBy(n).toDecimalPlaces(2);
  const f = r.plus(1).pow(n);
  return P.times(r).times(f).dividedBy(f.minus(1)).toDecimalPlaces(2);
}

/** Convert an amount between currencies using an explicit user rate (INR per USD). */
export function convert(amount: string, from: string, to: string, inrPerUsd: string): Dec | null {
  if (from === to) return dec(amount);
  const rate = toDec(inrPerUsd);
  if (!rate || rate.isZero()) return null;
  if (from === 'USD' && to === 'INR') return dec(amount).times(rate);
  if (from === 'INR' && to === 'USD') return dec(amount).dividedBy(rate);
  return null;
}

/** For chart pixel positions only (never for money math). */
export function toChartNumber(v: string | null | undefined): number {
  const d = toDec(v);
  return d ? d.toNumber() : 0;
}
