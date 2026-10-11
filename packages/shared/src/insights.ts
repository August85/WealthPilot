/** Deterministic exposure indicators (DECISIONS.md: fixed thresholds). Decimal arithmetic only. */
import { dec } from './decimal';

/** Share of `part` in `whole` as a fraction string (0..1), or null if undefined. */
export function shareOf(part: string | null | undefined, whole: string | null | undefined): string | null {
  if (part == null || whole == null) return null;
  const w = dec(whole);
  if (w.lte(0)) return null;
  return dec(part).div(w).toFixed(4);
}

/** "0.4567" → "45.7%". */
export function pctText(fraction: string): string {
  return `${dec(fraction).times(100).toDecimalPlaces(1).toString()}%`;
}

export type RiskLevel = 'low' | 'medium' | 'high';

/** Deterministic thresholds for the risk indicators; documented beside the indicator. */
export function riskLevel(fraction: string, medium: string, high: string): RiskLevel {
  const f = dec(fraction);
  if (f.gte(high)) return 'high';
  if (f.gte(medium)) return 'medium';
  return 'low';
}

/** Liquidity is a risk when it is low: high < 10%, medium < 25%. */
export function liquidityRisk(fraction: string): RiskLevel {
  const f = dec(fraction);
  if (f.lt('0.1')) return 'high';
  if (f.lt('0.25')) return 'medium';
  return 'low';
}
