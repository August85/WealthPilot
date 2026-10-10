import { describe, expect, it } from 'vitest';

import {
  accountCreateSchema,
  comparisonRequestSchema,
  compareDecimal,
  deleteRequestSchema,
  exportCreateSchema,
  fxRateCreateSchema,
  onboardingRequestSchema,
  rsuVestUpdateSchema,
  valuationCreateSchema,
} from '../src';

describe('compareDecimal', () => {
  it('compares exactly without floats', () => {
    expect(compareDecimal('0.1', '0.10')).toBe(0);
    expect(compareDecimal('10', '9.999999999999999999')).toBe(1);
    expect(compareDecimal('-1', '0')).toBe(-1);
    expect(compareDecimal('-0', '0')).toBe(0);
    expect(compareDecimal('-2', '-10')).toBe(1);
    expect(compareDecimal('100000000000000000000.01', '100000000000000000000.001')).toBe(1);
  });
});

describe('request schemas', () => {
  it('onboarding requires the disclaimer acknowledgement', () => {
    const base = {
      home_country: 'US',
      reporting_currency: 'USD',
      household_name: 'Our household',
      tax_residency: [{ jurisdiction: 'US', residency_type: 'resident', from_date: '2020-01-01', to_date: null }],
    };
    expect(onboardingRequestSchema.safeParse({ ...base, disclaimer_accepted: false }).success).toBe(false);
    expect(onboardingRequestSchema.safeParse({ ...base, disclaimer_accepted: true }).success).toBe(true);
  });

  it('account create validates kind/type pairing and FD details', () => {
    expect(
      accountCreateSchema.safeParse({ kind: 'liability', type: 'cash', name: 'x', country: 'US', currency: 'USD' }).success,
    ).toBe(false);
    const fd = {
      kind: 'asset',
      type: 'fixed_deposit',
      name: 'HDFC FD',
      country: 'IN',
      currency: 'INR',
      details: { principal: '850000', start_date: '2026-01-01', maturity_date: '2025-01-01', interest_rate_annual: '0.07', compounding: 'quarterly' },
    };
    const res = accountCreateSchema.safeParse(fd);
    expect(res.success).toBe(false);
    expect(res.error!.issues.some((i) => i.path.join('.') === 'details.maturity_date')).toBe(true);
    expect(
      accountCreateSchema.safeParse({ ...fd, details: { ...fd.details, maturity_date: '2027-01-01' } }).success,
    ).toBe(true);
  });

  it('valuation amounts must be non-negative decimal strings', () => {
    const ok = { amount: '10000.00', as_of: '2026-10-01', verification_status: 'verified' };
    expect(valuationCreateSchema.safeParse(ok).success).toBe(true);
    expect(valuationCreateSchema.safeParse({ ...ok, amount: '-5' }).success).toBe(false);
    expect(valuationCreateSchema.safeParse({ ...ok, amount: '1,000' }).success).toBe(false);
    expect(valuationCreateSchema.safeParse({ ...ok, amount: 1000 }).success).toBe(false);
    expect(valuationCreateSchema.safeParse({ ...ok, as_of: '2026-02-30' }).success).toBe(false);
  });

  it('vest update enforces withheld ≤ vested', () => {
    expect(
      rsuVestUpdateSchema.safeParse({ status: 'vested', vested_shares: '100', vest_fmv: '180', withheld_shares: '30' }).success,
    ).toBe(true);
    expect(
      rsuVestUpdateSchema.safeParse({ status: 'vested', vested_shares: '100', vest_fmv: '180', withheld_shares: '100.5' }).success,
    ).toBe(false);
  });

  it('fx rates must be positive with different currencies', () => {
    expect(fxRateCreateSchema.safeParse({ base: 'USD', quote: 'INR', rate: '85.00', as_of: '2026-10-01' }).success).toBe(true);
    expect(fxRateCreateSchema.safeParse({ base: 'USD', quote: 'USD', rate: '1', as_of: '2026-10-01' }).success).toBe(false);
    expect(fxRateCreateSchema.safeParse({ base: 'USD', quote: 'INR', rate: '0', as_of: '2026-10-01' }).success).toBe(false);
  });

  it('exports: pdf only for run scope, run scope needs run_id', () => {
    expect(exportCreateSchema.safeParse({ format: 'pdf', scope: 'balances' }).success).toBe(false);
    expect(exportCreateSchema.safeParse({ format: 'csv', scope: 'run' }).success).toBe(false);
    expect(
      exportCreateSchema.safeParse({ format: 'pdf', scope: 'run', run_id: '2b1c3d4e-5f60-4718-8293-a4b5c6d7e8f9' }).success,
    ).toBe(true);
  });

  it('comparisons accept at most four runs', () => {
    const id = '2b1c3d4e-5f60-4718-8293-a4b5c6d7e8f9';
    expect(comparisonRequestSchema.safeParse({ run_ids: [id, id, id, id] }).success).toBe(true);
    expect(comparisonRequestSchema.safeParse({ run_ids: [id, id, id, id, id] }).success).toBe(false);
  });

  it('delete request needs the literal DELETE', () => {
    expect(deleteRequestSchema.safeParse({ confirm: 'delete' }).success).toBe(false);
    expect(deleteRequestSchema.safeParse({ confirm: 'DELETE' }).success).toBe(true);
  });
});
