/**
 * Type-specific `details` fields from the contract ("details by type"). Percent fields are entered as
 * percentages ("6.25") and sent as fractions ("0.0625"), matching the contract's rate convention.
 */
import { EPF_ACCESS_STATUSES, FD_COMPOUNDINGS, isLiabilityType } from '@wealthpilot/contracts';

import { fractionToPercent, percentToFraction } from './decimal';

export type DetailFieldKind = 'money' | 'percent' | 'decimal' | 'int' | 'date' | 'choice' | 'bool' | 'text';

export interface DetailField {
  key: string;
  label: string;
  kind: DetailFieldKind;
  required?: boolean;
  /** Percent that may be negative (e.g. a return assumption). */
  signed?: boolean;
  helper?: string;
  options?: { value: string; label: string }[];
  /** Default shown in the form (in form units, i.e. percent for percent fields). */
  defaultValue?: string | boolean;
}

const EPF_ACCESS_LABELS: Record<string, string> = {
  unknown: 'Unknown',
  restricted: 'Restricted',
  user_verified_accessible: 'I verified it is accessible',
};

const COMPOUNDING_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  annually: 'Annually',
  at_maturity: 'At maturity',
};

const LIABILITY_FIELDS: DetailField[] = [
  { key: 'interest_rate_annual', label: 'Interest rate (annual %)', kind: 'percent' },
  { key: 'monthly_payment', label: 'Monthly payment', kind: 'money' },
  { key: 'term_months_remaining', label: 'Months remaining', kind: 'int' },
];

export const DETAIL_FIELDS: Record<string, DetailField[]> = {
  retirement_401k: [
    { key: 'pretax_balance', label: 'Pre-tax balance', kind: 'money', helper: 'Kept separate from Roth (not merged).' },
    { key: 'roth_balance', label: 'Roth balance', kind: 'money' },
    { key: 'employee_contribution_annual', label: 'Your contribution per year', kind: 'money' },
    { key: 'employee_roth_pct', label: 'Share of your contribution to Roth (%)', kind: 'percent' },
    { key: 'employer_match_rate', label: 'Employer match rate (%)', kind: 'percent', helper: 'e.g. 50 for a 50% match' },
    { key: 'employer_match_up_to_pct_of_salary', label: 'Match up to (% of salary)', kind: 'percent', helper: 'e.g. 6' },
    {
      key: 'contribution_limit_annual',
      label: 'Annual contribution limit (your input)',
      kind: 'money',
      helper: 'Enter the limit that applies to you. WealthPilot does not hard-code IRS limits.',
    },
    { key: 'access_age', label: 'Access age (assumption)', kind: 'decimal', defaultValue: '59.5', helper: 'Editable constraint, not an eligibility claim.' },
    { key: 'early_withdrawal_penalty_pct', label: 'Early-withdrawal penalty (%)', kind: 'percent' },
  ],
  ira_traditional: [
    { key: 'annual_contribution', label: 'Annual contribution', kind: 'money' },
    { key: 'access_age', label: 'Access age (assumption)', kind: 'decimal', defaultValue: '59.5' },
  ],
  ira_roth: [
    { key: 'annual_contribution', label: 'Annual contribution', kind: 'money' },
    { key: 'access_age', label: 'Access age (assumption)', kind: 'decimal', defaultValue: '59.5' },
  ],
  hsa: [
    { key: 'annual_contribution', label: 'Annual contribution', kind: 'money' },
    { key: 'access_age', label: 'Access age (assumption)', kind: 'decimal' },
  ],
  epf: [
    { key: 'employee_component', label: 'Employee component', kind: 'money' },
    { key: 'employer_component', label: 'Employer component', kind: 'money' },
    { key: 'monthly_employee_contribution', label: 'Monthly employee contribution', kind: 'money' },
    { key: 'monthly_employer_contribution', label: 'Monthly employer contribution', kind: 'money' },
    { key: 'interest_rate_annual', label: 'Interest rate (annual %, your assumption)', kind: 'percent' },
    {
      key: 'access_status',
      label: 'Access status',
      kind: 'choice',
      defaultValue: 'unknown',
      options: EPF_ACCESS_STATUSES.map((s) => ({ value: s, label: EPF_ACCESS_LABELS[s] ?? s })),
      helper: 'WealthPilot never decides EPF withdrawal eligibility. Verify with a professional.',
    },
    { key: 'notes', label: 'Notes', kind: 'text' },
  ],
  ppf: [
    { key: 'annual_contribution', label: 'Annual contribution', kind: 'money' },
    { key: 'interest_rate_annual', label: 'Interest rate (annual %)', kind: 'percent' },
    { key: 'maturity_date', label: 'Maturity date', kind: 'date' },
  ],
  fixed_deposit: [
    { key: 'principal', label: 'Principal', kind: 'money', required: true },
    { key: 'start_date', label: 'Start date', kind: 'date', required: true },
    { key: 'maturity_date', label: 'Maturity date', kind: 'date', required: true },
    { key: 'interest_rate_annual', label: 'Interest rate (annual %)', kind: 'percent', required: true },
    {
      key: 'compounding',
      label: 'Compounding',
      kind: 'choice',
      required: true,
      defaultValue: 'quarterly',
      options: FD_COMPOUNDINGS.map((c) => ({ value: c, label: COMPOUNDING_LABELS[c] ?? c })),
    },
    { key: 'tds_rate', label: 'TDS rate (%, your assumption)', kind: 'percent' },
  ],
  brokerage: [{ key: 'expected_return_annual', label: 'Expected return (annual %, assumption)', kind: 'percent', signed: true }],
  mutual_fund: [{ key: 'expected_return_annual', label: 'Expected return (annual %, assumption)', kind: 'percent', signed: true }],
  real_estate: [
    { key: 'is_primary_residence', label: 'Primary residence', kind: 'bool', defaultValue: false },
    { key: 'rental_income_monthly', label: 'Rental income per month', kind: 'money' },
    { key: 'appreciation_annual', label: 'Appreciation (annual %, assumption)', kind: 'percent', signed: true },
  ],
};

export function detailFieldsFor(type: string): DetailField[] {
  if (DETAIL_FIELDS[type]) return DETAIL_FIELDS[type]!;
  if (isLiabilityType(type)) return LIABILITY_FIELDS;
  return [];
}

export type DetailFormValues = Record<string, string | boolean>;

export function defaultDetailValues(type: string): DetailFormValues {
  const out: DetailFormValues = {};
  for (const f of detailFieldsFor(type)) {
    out[f.key] = f.defaultValue ?? (f.kind === 'bool' ? false : '');
  }
  return out;
}

/** Form values → contract `details` (empty fields omitted, percents → fractions, ints → numbers). */
export function detailsToPayload(type: string, values: DetailFormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of detailFieldsFor(type)) {
    const v = values[f.key];
    if (f.kind === 'bool') {
      out[f.key] = !!v;
      continue;
    }
    const s = typeof v === 'string' ? v.trim() : '';
    if (s === '') continue;
    if (f.kind === 'percent') out[f.key] = percentToFraction(s) || s;
    else if (f.kind === 'int') out[f.key] = Number.parseInt(s, 10);
    else if (f.kind === 'money' || f.kind === 'decimal') out[f.key] = s.replace(/[,\s$₹]/g, '');
    else out[f.key] = s;
  }
  return out;
}

/** Contract `details` → form values (fractions → percents). */
export function payloadToDetails(type: string, details: Record<string, unknown> | null | undefined): DetailFormValues {
  const out = defaultDetailValues(type);
  if (!details) return out;
  for (const f of detailFieldsFor(type)) {
    const v = details[f.key];
    if (v === undefined || v === null) continue;
    if (f.kind === 'bool') out[f.key] = !!v;
    else if (f.kind === 'percent') out[f.key] = fractionToPercent(String(v));
    else out[f.key] = String(v);
  }
  return out;
}

/** Returns field-level errors for required/format problems in the details form. */
export function validateDetails(type: string, values: DetailFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of detailFieldsFor(type)) {
    const v = values[f.key];
    if (f.kind === 'bool' || f.kind === 'text' || f.kind === 'choice') {
      if (f.required && (v === '' || v === undefined)) errors[f.key] = `${f.label} is required`;
      continue;
    }
    const s = typeof v === 'string' ? v.trim().replace(/[,\s$₹]/g, '') : '';
    if (s === '') {
      if (f.required) errors[f.key] = `${f.label} is required`;
      continue;
    }
    if (f.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) errors[f.key] = 'Use YYYY-MM-DD';
    const numRe = f.signed ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/;
    if ((f.kind === 'money' || f.kind === 'decimal' || f.kind === 'percent') && !numRe.test(s)) {
      errors[f.key] = f.signed ? 'Enter a number' : 'Enter a number of zero or more';
    }
    if (f.kind === 'int' && !/^\d+$/.test(s)) errors[f.key] = 'Enter a whole number';
  }
  return errors;
}
