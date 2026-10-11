/** Run-result presentation helpers shared by mobile and web (labels, metric formatting, real-value deflation). */
import type { YearlyRow } from '@wealthpilot/contracts';

import { formatDate } from './dates';
import { D, dec } from './decimal';
import { formatMoney } from './money';

export interface ForecastContext {
  asOf: string | null | undefined;
  scenario: string | null | undefined;
  assumptions: string | null | undefined;
}

export function contextLabel(versionNumber: number | null | undefined, inputHash: string | null | undefined): string {
  const hash = inputHash ? inputHash.replace(/^sha256:/, '').slice(0, 8) : null;
  return `${versionNumber != null ? `v${versionNumber}` : 'version —'}${hash ? ` · ${hash}` : ''}`;
}

export const METRIC_LABELS: Record<string, string> = {
  net_worth_now: 'Net worth now',
  liquid_net_worth_now: 'Liquid net worth now',
  net_worth_at_retirement: 'Net worth at retirement',
  retirement_balance_at_retirement: 'Retirement balance at retirement',
  ending_balance_at_life_expectancy: 'Ending balance at life expectancy',
  first_deficit_age: 'First deficit age',
  years_in_deficit: 'Years in deficit',
  home_cash_needed: 'Home: total cash needed',
  home_cash_available_at_purchase: 'Home: cash available at purchase',
  home_funding_gap: 'Home: funding gap',
  home_earliest_feasible_date: 'Home: earliest feasible date',
  home_pi_monthly: 'Home: principal & interest / month',
  home_all_in_monthly: 'Home: all-in housing cost / month',
  rsu_net_proceeds_to_purchase: 'Net RSU proceeds to purchase',
};

export function formatMetric(key: string, value: unknown, currency: string): string {
  if (value === null || value === undefined) return '—';
  if (key === 'first_deficit_age') return String(value);
  if (key === 'years_in_deficit') return String(value);
  if (key === 'home_earliest_feasible_date') return formatDate(String(value));
  return formatMoney(String(value), currency);
}

/** Metrics shown side by side in comparisons (FR-SCN-003). */
export const COMPARE_METRICS = [
  'net_worth_now',
  'liquid_net_worth_now',
  'net_worth_at_retirement',
  'retirement_balance_at_retirement',
  'ending_balance_at_life_expectancy',
  'first_deficit_age',
  'years_in_deficit',
  'home_funding_gap',
  'home_earliest_feasible_date',
  'home_all_in_monthly',
] as const;

/** Real value = nominal ÷ (1 + inflation)^(years since base). Display transform only; decimal math. */
export function deflate(rows: YearlyRow[], key: keyof YearlyRow, inflation: string, baseYear: number): string[] {
  const inf = dec(inflation).plus(1);
  return rows.map((r) => {
    const n = Math.max(0, r.year - baseYear);
    return dec(r[key] as string)
      .dividedBy(inf.pow(n))
      .toDecimalPlaces(2, D.ROUND_HALF_UP)
      .toFixed(2);
  });
}

export const SCENARIO_KIND_LABELS = { home: 'Home purchase', retirement: 'Retirement', general: 'General' } as const;

export const PRESET_LABELS: Record<string, string> = {
  baseline: 'Baseline',
  conservative: 'Conservative',
  optimistic: 'Optimistic',
  custom: 'Custom',
};

export const PRESET_HELP: Record<string, string> = {
  baseline: 'Your data with neutral assumptions.',
  conservative: 'Returns −2pp, inflation +1pp, INR depreciation +1pp, RSU growth −10pp, mortgage rate +1pp.',
  optimistic: 'Returns +1pp, RSU growth +5pp, INR depreciation −1pp.',
  custom: 'Start from baseline and edit anything.',
};

/** Whether a warning code relates to an explained metric (S18). */
export function isRelatedWarning(metric: string, code: string): boolean {
  if (metric.startsWith('home_')) return code.startsWith('HOME') || code === 'ILLUSTRATIVE_TAX' || code.startsWith('FX');
  if (metric.includes('retirement') || metric.includes('deficit')) return code.startsWith('RETIREMENT') || code.startsWith('EPF');
  return true;
}
