/**
 * Telemetry interface (spec §13: anonymous event IDs and coarse metadata only).
 *
 * The type system only admits a fixed set of event names and coarse, non-identifying properties:
 * no amounts, balances, salaries, names, emails, account IDs or free text. The default implementation is a
 * no-op; a real sink can be plugged in later via `setAnalyticsSink` after privacy review.
 */

export type AnalyticsEvent =
  | 'app_opened'
  | 'signed_in'
  | 'onboarding_completed'
  | 'account_created'
  | 'valuation_added'
  | 'rsu_grant_created'
  | 'goal_created'
  | 'scenario_created'
  | 'scenario_run_requested'
  | 'comparison_viewed'
  | 'export_requested'
  | 'currency_toggled'
  | 'paywall_viewed'
  | 'chart_table_toggled';

/** Only enumerated, coarse values are allowed. Numbers are bucket indexes, never amounts. */
export interface AnalyticsProps {
  screen?: string;
  account_type?: string;
  country?: 'US' | 'IN' | 'OTHER';
  currency?: 'USD' | 'INR';
  format?: 'csv' | 'json' | 'pdf';
  scenario_kind?: 'home' | 'retirement' | 'general';
  preset?: 'baseline' | 'conservative' | 'optimistic' | 'custom';
  count_bucket?: '0' | '1' | '2-5' | '6-10' | '10+';
  reason?: string;
}

export interface AnalyticsSink {
  track(event: AnalyticsEvent, props?: AnalyticsProps): void;
}

const noopSink: AnalyticsSink = { track: () => {} };
let sink: AnalyticsSink = noopSink;

const FORBIDDEN_KEY = /(amount|balance|salary|price|value|email|name|token|id$|_id|note|rate)/i;

/** Defensive scrub in case a caller casts around the types. */
export function scrubProps(props?: AnalyticsProps): AnalyticsProps | undefined {
  if (!props) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (FORBIDDEN_KEY.test(k)) continue;
    if (typeof v !== 'string') continue;
    if (/\d{3,}/.test(v) || v.includes('@')) continue; // looks like an amount or PII
    out[k] = v;
  }
  return out as AnalyticsProps;
}

export const analytics = {
  track(event: AnalyticsEvent, props?: AnalyticsProps) {
    try {
      sink.track(event, scrubProps(props));
    } catch {
      // Telemetry must never break the app.
    }
  },
};

export function setAnalyticsSink(next: AnalyticsSink | null) {
  sink = next ?? noopSink;
}

export function countBucket(n: number): NonNullable<AnalyticsProps['count_bucket']> {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 10) return '6-10';
  return '10+';
}
