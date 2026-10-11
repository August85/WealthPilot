import { describe, expect, it } from 'vitest';

import {
  formatAssumptionValue,
  buildDevToken,
  buildExportRequest,
  contextLabel,
  deflate,
  formatMetric,
  formatsFor,
  liquidityRisk,
  normalizePreferences,
  riskLevel,
  shareOf,
} from '../src';

describe('results helpers', () => {
  it('labels forecast context with version and short hash', () => {
    expect(contextLabel(2, 'sha256:abcdef1234567890')).toBe('v2 · abcdef12');
    expect(contextLabel(null, null)).toBe('version —');
  });

  it('formats metrics by kind', () => {
    expect(formatMetric('home_pi_monthly', '6067.85', 'USD')).toBe('$6,067.85');
    expect(formatMetric('years_in_deficit', 3, 'USD')).toBe('3');
    expect(formatMetric('home_earliest_feasible_date', '2031-04-01', 'USD')).toBe('Apr 1, 2031');
    expect(formatMetric('net_worth_now', null, 'INR')).toBe('—');
  });

  it('deflates nominal values with decimal math', () => {
    const rows = [
      { year: 2026, net_worth: '1000.00' },
      { year: 2027, net_worth: '1100.00' },
    ] as never;
    expect(deflate(rows, 'net_worth' as never, '0.1', 2026)).toEqual(['1000.00', '1000.00']);
  });
});

describe('insights helpers', () => {
  it('computes shares and risk levels deterministically', () => {
    expect(shareOf('25', '100')).toBe('0.2500');
    expect(shareOf('1', '0')).toBeNull();
    expect(riskLevel('0.5', '0.25', '0.5')).toBe('high');
    expect(riskLevel('0.3', '0.25', '0.5')).toBe('medium');
    expect(liquidityRisk('0.05')).toBe('high');
    expect(liquidityRisk('0.5')).toBe('low');
  });
});

describe('exports, notifications, auth', () => {
  it('only allows PDF for run exports', () => {
    expect(formatsFor('balances')).toEqual(['csv', 'json']);
    expect(formatsFor('run')[0]).toBe('pdf');
    expect(buildExportRequest('run', 'pdf', 'r1')).toEqual({ scope: 'run', format: 'pdf', run_id: 'r1' });
    expect(buildExportRequest('balances', 'csv', 'r1')).toEqual({ scope: 'balances', format: 'csv' });
  });

  it('fills every notification type, defaulting to off', () => {
    const prefs = normalizePreferences([{ type: 'vest_reminder', channel: 'push', enabled: true }]);
    expect(prefs).toHaveLength(3);
    expect(prefs.filter((p) => p.enabled)).toHaveLength(1);
  });

  it('builds dev tokens only from valid input', () => {
    expect(buildDevToken('demo', 'Demo@Example.test')).toBe('dev:demo:demo@example.test');
    expect(buildDevToken('a b', 'x@y.z')).toBeNull();
    expect(buildDevToken('ok', 'not-an-email')).toBeNull();
  });
});

describe('formatAssumptionValue (sensitivity inputs)', () => {
  it('formats rates as percentages and money as money', () => {
    expect(formatAssumptionValue('returns.us_portfolio_annual', '0.04', 'USD')).toBe('4%');
    expect(formatAssumptionValue('retirement.spending_monthly_today', '6400.00', 'USD')).toBe('$6,400.00');
    expect(formatAssumptionValue('retirement.spending_monthly_today', '6400.00', 'INR')).toBe('₹6,400.00');
    expect(formatAssumptionValue('household.retirement_age', '65', 'USD')).toBe('65');
    expect(formatAssumptionValue('returns.cash_annual', null, 'USD')).toBe('—');
  });
});
