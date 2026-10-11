import { accountCreateSchema } from '@wealthpilot/contracts';
import {
  addAccountFormSchema,
  assumptionsToForm,
  buildAccountCreate,
  defaultAddAccountValues,
  formToAssumptions,
  residencyFormSchema,
  validateAssumptions,
} from '@wealthpilot/shared';
import { describe, expect, it } from 'vitest';

import { assumptions } from '@/test/fixtures';

import { valuationFormSchema } from '../accounts/AccountDetailPage';
import { fxFormSchema } from '../fx/FxPage';
import { goalFormSchema } from '../goals/GoalFormPage';

const errorsOf = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]));

describe('add account form', () => {
  it('builds a contract body with decimal strings and fractions', () => {
    const v = {
      ...defaultAddAccountValues('fixed_deposit'),
      name: 'SBI FD',
      amount: '8,50,000',
      as_of: '2026-10-01',
      details: {
        principal: '800000',
        start_date: '2025-10-01',
        maturity_date: '2027-10-01',
        interest_rate_annual: '7.1',
        compounding: 'quarterly',
        tds_rate: '',
      },
    };
    const body = buildAccountCreate(addAccountFormSchema.parse(v));
    expect(body).toMatchObject({
      kind: 'asset',
      type: 'fixed_deposit',
      country: 'IN',
      currency: 'INR',
      initial_valuation: { amount: '850000', as_of: '2026-10-01', verification_status: 'estimated' },
    });
    expect(body.details).toMatchObject({ principal: '800000', interest_rate_annual: '0.071' });
    expect(accountCreateSchema.safeParse(body).success).toBe(true);
  });

  it('rejects negative amounts, bad ownership and missing required details', () => {
    const v = { ...defaultAddAccountValues('fixed_deposit'), name: '', amount: '-5', ownership_pct: '150' };
    const errors = errorsOf(addAccountFormSchema.safeParse(v));
    expect(errors.name).toBeDefined();
    expect(errors.amount).toMatch(/never negative|amount/i);
    expect(errors.ownership_pct).toMatch(/Ownership/);
    expect(errors['details.principal']).toMatch(/required/);
  });
});

describe('valuation form', () => {
  it('accepts grouped amounts and rejects negatives and bad dates', () => {
    expect(valuationFormSchema.safeParse({ amount: '12,34,567.89', as_of: '2026-10-01', verification_status: 'verified', note: '' }).success).toBe(true);
    const errors = errorsOf(valuationFormSchema.safeParse({ amount: '-1', as_of: '10/01/2026', verification_status: 'estimated', note: '' }));
    expect(errors.amount).toMatch(/never negative/);
    expect(errors.as_of).toMatch(/YYYY-MM-DD/);
  });
});

describe('goal form', () => {
  const base = { type: 'home_purchase', name: 'Bay Area home', target_date: '2028-06-01', target_amount: '250,000', currency: 'USD', priority: '1', scenario_id: '' };
  it('accepts a valid goal', () => {
    expect(goalFormSchema.safeParse(base).success).toBe(true);
  });
  it('requires a name and a positive amount', () => {
    const errors = errorsOf(goalFormSchema.safeParse({ ...base, name: ' ', target_amount: '-10' }));
    expect(errors.name).toBeDefined();
    expect(errors.target_amount).toBeDefined();
  });
});

describe('FX form', () => {
  it('requires a positive rate and an ISO date', () => {
    expect(fxFormSchema.safeParse({ rate: '85', as_of: '2026-10-11' }).success).toBe(true);
    expect(errorsOf(fxFormSchema.safeParse({ rate: '0', as_of: '2026-10-11' })).rate).toBeDefined();
    expect(errorsOf(fxFormSchema.safeParse({ rate: 'abc', as_of: 'today' })).as_of).toBeDefined();
  });
});

describe('residency form', () => {
  const base = {
    home_country: 'US' as const,
    reporting_currency: 'USD' as const,
    disclaimer_accepted: true,
    tax_residency: [{ jurisdiction: 'US' as const, residency_type: 'resident' as const, from_date: '2020-01-01', to_date: '', verified_by_user: false }],
  };
  it('maps an empty end date to null (ongoing)', () => {
    expect(residencyFormSchema.parse(base).tax_residency[0]?.to_date).toBeNull();
  });
  it('requires the acknowledgement and ordered dates', () => {
    expect(errorsOf(residencyFormSchema.safeParse({ ...base, disclaimer_accepted: false })).disclaimer_accepted).toBeDefined();
    const bad = { ...base, tax_residency: [{ ...base.tax_residency[0], to_date: '2019-01-01' }] };
    expect(errorsOf(residencyFormSchema.safeParse(bad))['tax_residency.0.to_date']).toMatch(/on or after/);
  });
});

describe('scenario assumptions', () => {
  it('accepts server defaults with rsu: null and social_security_start_age: null', () => {
    const fresh = { ...assumptions, rsu: null, retirement: { ...assumptions.retirement, social_security_start_age: null } };
    const form = assumptionsToForm(fresh);
    expect(form.enabled.rsu).toBe(false);
    const res = validateAssumptions(formToAssumptions(form, fresh));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.rsu).toBeNull();
      expect(res.value.retirement.social_security_start_age).toBeNull();
    }
  });

  it('starts a switched-on home section from the empty block and validates once required inputs are filled', () => {
    const base = { ...assumptions, home: null };
    const form = assumptionsToForm(base);
    expect(form.enabled.home).toBe(false);
    const home = form.values.home as Record<string, unknown>;
    expect(home.target_price).toBe('');
    expect(home.term_years).toBe('30');
    form.enabled.home = true;
    const empty = validateAssumptions(formToAssumptions(form, base));
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(Object.keys(empty.errors)).toEqual(
        expect.arrayContaining(['home.target_price', 'home.purchase_date', 'home.down_payment_pct', 'home.mortgage_rate_annual']),
      );
      expect(Object.keys(empty.errors).some((k) => k.startsWith('home.funding_sources'))).toBe(false);
    }
    Object.assign(home, { target_price: '1200000', purchase_date: '2029-06-01', down_payment_pct: '20', mortgage_rate_annual: '6.5' });
    const res = validateAssumptions(formToAssumptions(form, base));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.home?.funding_sources).toEqual({ us_cash: true, brokerage: true, rsu_proceeds: true, india_liquid: false });
      expect(res.value.home?.down_payment_pct).toBe('0.2');
    }
  });
});
