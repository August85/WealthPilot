import { accountCreateSchema } from '@wealthpilot/contracts';

import { assumptions } from '@/test/fixtures';

import { addAccountFormSchema, buildAccountCreate, defaultAddAccountValues, suggested401kTotal } from '../accounts/accountForm';
import { residencyFormSchema } from '../onboarding/ResidencyForm';
import { buildGrantCreate, grantFormSchema } from '../rsu/grantForm';
import { previewSchedule } from '../rsu/schedule';
import { assumptionsToForm, formToAssumptions, validateAssumptions } from '../scenarios/assumptionFields';
import { buildExportRequest, formatsFor } from '../profile/ExportScreen';
import { normalizePreferences } from '../profile/NotificationsScreen';

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
    const parsed = addAccountFormSchema.parse(v);
    const body = buildAccountCreate(parsed);
    expect(body).toMatchObject({
      kind: 'asset',
      type: 'fixed_deposit',
      country: 'IN',
      currency: 'INR',
      ownership_pct: '100',
      initial_valuation: { amount: '850000', as_of: '2026-10-01', verification_status: 'estimated' },
    });
    expect(body.details).toMatchObject({ principal: '800000', interest_rate_annual: '0.071', compounding: 'quarterly' });
    expect(typeof body.initial_valuation!.amount).toBe('string');
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

  it('requires a note when the default accessibility is overridden', () => {
    const v = { ...defaultAddAccountValues('retirement_401k'), accessibility: 'liquid' as const };
    expect(errorsOf(addAccountFormSchema.safeParse(v)).accessibility_override_note).toBeDefined();
    const ok = addAccountFormSchema.safeParse({ ...v, accessibility_override_note: 'Separated from employer' });
    expect(ok.success).toBe(true);
  });

  it('defaults goal eligibility to liquid assets only', () => {
    expect(defaultAddAccountValues('savings').goal_eligible).toBe(true);
    expect(defaultAddAccountValues('retirement_401k').goal_eligible).toBe(false);
    expect(defaultAddAccountValues('mortgage').goal_eligible).toBe(false);
  });

  it('sums 401(k) pre-tax and Roth exactly for the suggestion', () => {
    expect(suggested401kTotal({ pretax_balance: '100000.10', roth_balance: '20000.20' })).toBe('120000.30');
    expect(suggested401kTotal({ pretax_balance: '', roth_balance: '' })).toBeNull();
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
    const out = residencyFormSchema.parse(base);
    expect(out.tax_residency[0]!.to_date).toBeNull();
  });

  it('requires the not-advice acknowledgement and ordered dates', () => {
    expect(errorsOf(residencyFormSchema.safeParse({ ...base, disclaimer_accepted: false })).disclaimer_accepted).toBeDefined();
    const bad = { ...base, tax_residency: [{ ...base.tax_residency[0]!, to_date: '2019-01-01' }] };
    expect(errorsOf(residencyFormSchema.safeParse(bad))['tax_residency.0.to_date']).toMatch(/on or after/);
    expect(errorsOf(residencyFormSchema.safeParse({ ...base, tax_residency: [] })).tax_residency).toBeDefined();
  });
});

describe('RSU grant form', () => {
  const form = {
    employer_name: 'Acme',
    symbol: 'acme',
    grant_date: '2026-01-15',
    granted_shares: '1000',
    award_currency: 'USD' as const,
    grant_price: '',
    withholding_pct: '22',
    held_in_account_id: '',
    use_schedule: true,
    start_date: '2026-01-15',
    cliff_months: '12',
    frequency_months: '3',
    total_months: '48',
  };

  it('builds the create body with a schedule and fraction withholding', () => {
    const body = buildGrantCreate(grantFormSchema.parse(form));
    expect(body).toMatchObject({
      symbol: 'ACME',
      granted_shares: '1000',
      default_withholding_rate: '0.22',
      schedule: { start_date: '2026-01-15', cliff_months: 12, frequency_months: 3, total_months: 48 },
    });
  });

  it('rejects a cliff longer than the vesting period', () => {
    expect(errorsOf(grantFormSchema.safeParse({ ...form, cliff_months: '60' })).cliff_months).toBeDefined();
  });

  it('previews a schedule whose shares sum to the grant', () => {
    const events = previewSchedule('1000', { start_date: '2026-01-15', cliff_months: 12, frequency_months: 3, total_months: 48 });
    expect(events[0]).toEqual({ vest_date: '2027-01-15', shares: '248' });
    expect(events).toHaveLength(13);
    const sum = events.reduce((s, e) => s + Number(e.shares), 0);
    expect(sum).toBe(1000);
  });
});

describe('scenario assumptions form', () => {
  it('round-trips through the form and validates against the contract schema', () => {
    const form = assumptionsToForm(assumptions);
    expect((form.values.returns as Record<string, string>).us_portfolio_annual).toBe('6');
    const raw = formToAssumptions(form, assumptions);
    const res = validateAssumptions(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.returns.us_portfolio_annual).toBe('0.06');
      expect(res.value.home?.target_price).toBe('1200000.00');
    }
  });

  it('reports invalid fields by path', () => {
    const form = assumptionsToForm(assumptions);
    (form.values.household as Record<string, string>).retirement_age = '';
    const res = validateAssumptions(formToAssumptions(form, assumptions));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.keys(res.errors)).toContain('household.retirement_age');
  });

  it('nulls switched-off optional sections', () => {
    const form = assumptionsToForm(assumptions);
    form.enabled.home = false;
    expect(formToAssumptions(form, assumptions).home).toBeNull();
  });
});

describe('export and notification helpers', () => {
  it('only offers PDF for run exports and includes run_id only then', () => {
    expect(formatsFor('balances')).toEqual(['csv', 'json']);
    expect(formatsFor('run')).toContain('pdf');
    expect(buildExportRequest('balances', 'csv', 'r1')).toEqual({ scope: 'balances', format: 'csv' });
    expect(buildExportRequest('run', 'pdf', 'r1')).toEqual({ scope: 'run', format: 'pdf', run_id: 'r1' });
  });

  it('fills missing notification preferences as opt-in (off)', () => {
    const prefs = normalizePreferences([{ type: 'vest_reminder', channel: 'push', enabled: true }]);
    expect(prefs).toEqual([
      { type: 'vest_reminder', channel: 'push', enabled: true },
      { type: 'stale_balance', channel: 'push', enabled: false },
      { type: 'goal_milestone', channel: 'push', enabled: false },
    ]);
  });
});
