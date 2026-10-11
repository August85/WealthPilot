/**
 * Field catalogue for every ScenarioAssumptions value, grouped into editor sections (S16).
 * Rates are edited as percentages and stored as fractions; integers are edited as strings.
 */
import {
  RETIREMENT_LOCATIONS,
  RSU_STRATEGIES,
  WITHDRAWAL_BUCKETS,
  scenarioAssumptionsSchema,
  type ScenarioAssumptions,
} from '@wealthpilot/contracts';

import { fractionToPercent, percentToFraction } from './decimal';

export type AssumptionKind = 'percent' | 'money' | 'decimal' | 'int' | 'date' | 'choice' | 'bool' | 'nullableInt';

export interface AssumptionField {
  path: string;
  label: string;
  kind: AssumptionKind;
  helper?: string;
  options?: { value: string; label: string }[];
  /** Currency path for money prefixes. */
  currencyPath?: string;
}

export type SectionKey =
  | 'general'
  | 'household'
  | 'income'
  | 'returns'
  | 'inflation'
  | 'fx'
  | 'rsu'
  | 'retirement_401k'
  | 'epf'
  | 'retirement'
  | 'home';

export interface AssumptionSection {
  key: SectionKey;
  title: string;
  /** Sections that may be null in the contract get an on/off switch. */
  nullable?: boolean;
  description?: string;
  fields: AssumptionField[];
}

const cur = [
  { value: 'USD', label: 'USD' },
  { value: 'INR', label: 'INR' },
];

export const ASSUMPTION_SECTIONS: AssumptionSection[] = [
  {
    key: 'general',
    title: 'General',
    fields: [
      { path: 'base_date', label: 'Base date', kind: 'date' },
      { path: 'reporting_currency', label: 'Reporting currency', kind: 'choice', options: cur },
      { path: 'horizon_years', label: 'Horizon (years)', kind: 'int' },
    ],
  },
  {
    key: 'household',
    title: 'Household',
    fields: [
      { path: 'household.current_age', label: 'Current age', kind: 'int' },
      { path: 'household.retirement_age', label: 'Retirement age', kind: 'int' },
      { path: 'household.life_expectancy', label: 'Plan to age (life expectancy)', kind: 'int' },
    ],
  },
  {
    key: 'income',
    title: 'Income and spending',
    fields: [
      { path: 'income.currency', label: 'Income currency', kind: 'choice', options: cur },
      { path: 'income.salary_annual', label: 'Salary per year', kind: 'money', currencyPath: 'income.currency' },
      { path: 'income.bonus_annual', label: 'Bonus per year', kind: 'money', currencyPath: 'income.currency' },
      { path: 'income.salary_growth_annual', label: 'Salary growth (%/yr)', kind: 'percent' },
      { path: 'income.effective_tax_rate', label: 'Effective tax rate (%, illustrative)', kind: 'percent', helper: 'Your own illustrative rate — no tax rules are applied.' },
      { path: 'income.expense_currency', label: 'Expense currency', kind: 'choice', options: cur },
      { path: 'income.living_expenses_monthly', label: 'Living expenses per month', kind: 'money', currencyPath: 'income.expense_currency' },
    ],
  },
  {
    key: 'returns',
    title: 'Returns (nominal)',
    description: 'Assumptions, not forecasts of market performance.',
    fields: [
      { path: 'returns.us_portfolio_annual', label: 'US portfolio (%/yr)', kind: 'percent' },
      { path: 'returns.india_portfolio_annual', label: 'India portfolio (%/yr)', kind: 'percent' },
      { path: 'returns.cash_annual', label: 'Cash (%/yr)', kind: 'percent' },
      { path: 'returns.real_estate_annual', label: 'Real estate (%/yr)', kind: 'percent' },
    ],
  },
  {
    key: 'inflation',
    title: 'Inflation',
    fields: [
      { path: 'inflation.us_annual', label: 'US inflation (%/yr)', kind: 'percent' },
      { path: 'inflation.india_annual', label: 'India inflation (%/yr)', kind: 'percent' },
    ],
  },
  {
    key: 'fx',
    title: 'Currency (FX)',
    fields: [
      { path: 'fx.usd_inr_start', label: 'Starting INR per USD', kind: 'decimal' },
      { path: 'fx.inr_depreciation_annual', label: 'INR depreciation vs USD (%/yr)', kind: 'percent', helper: 'Negative = INR appreciates.' },
      { path: 'fx.transfer_cost_pct', label: 'Transfer cost/spread (%)', kind: 'percent' },
    ],
  },
  {
    key: 'rsu',
    title: 'RSUs',
    nullable: true,
    description: 'Unvested equity is never counted as current liquid assets; future vests appear only under these assumptions.',
    fields: [
      { path: 'rsu.price_now', label: 'Share price now (your entry)', kind: 'money' },
      { path: 'rsu.price_growth_annual', label: 'Share price growth (%/yr)', kind: 'percent' },
      {
        path: 'rsu.strategy',
        label: 'Strategy at vest',
        kind: 'choice',
        options: RSU_STRATEGIES.map((s) => ({ value: s, label: s === 'hold' ? 'Hold' : s === 'sell_on_vest' ? 'Sell on vest' : 'Sell a fraction' })),
      },
      { path: 'rsu.sell_fraction', label: 'Fraction sold (%)', kind: 'percent' },
      { path: 'rsu.withholding_rate', label: 'Withholding (%, illustrative)', kind: 'percent' },
      { path: 'rsu.additional_tax_rate', label: 'Additional tax (%, illustrative)', kind: 'percent' },
      { path: 'rsu.annual_refresh_value', label: 'Annual refresh grant value', kind: 'money' },
    ],
  },
  {
    key: 'retirement_401k',
    title: '401(k)',
    nullable: true,
    fields: [
      { path: 'retirement_401k.employee_contribution_annual', label: 'Your contribution per year', kind: 'money' },
      { path: 'retirement_401k.employer_match_rate', label: 'Employer match rate (%)', kind: 'percent' },
      { path: 'retirement_401k.match_up_to_pct_of_salary', label: 'Match up to (% of salary)', kind: 'percent' },
      { path: 'retirement_401k.contribution_limit_annual', label: 'Contribution limit (your input)', kind: 'money', helper: 'No IRS limits are hard-coded.' },
      { path: 'retirement_401k.access_age', label: 'Access age (assumption)', kind: 'decimal' },
    ],
  },
  {
    key: 'epf',
    title: 'EPF',
    nullable: true,
    description: 'EPF access is never assumed. Leave “accessible from age” empty unless you have verified it.',
    fields: [
      { path: 'epf.interest_rate_annual', label: 'Interest rate (%/yr)', kind: 'percent' },
      { path: 'epf.monthly_contribution', label: 'Monthly contribution', kind: 'money' },
      { path: 'epf.accessible_from_age', label: 'Accessible from age (optional)', kind: 'nullableInt' },
    ],
  },
  {
    key: 'retirement',
    title: 'Retirement',
    fields: [
      {
        path: 'retirement.location',
        label: 'Retire in',
        kind: 'choice',
        options: RETIREMENT_LOCATIONS.map((l) => ({ value: l, label: l === 'US' ? 'United States' : 'India' })),
      },
      { path: 'retirement.spending_monthly_today', label: 'Spending per month (today’s money)', kind: 'money' },
      { path: 'retirement.healthcare_monthly_today', label: 'Healthcare per month (today’s money)', kind: 'money' },
      { path: 'retirement.healthcare_inflation_annual', label: 'Healthcare inflation (%/yr)', kind: 'percent' },
      { path: 'retirement.social_security_monthly_today', label: 'Social Security per month (your estimate)', kind: 'money', helper: 'Unverified until you source it from your SSA statement.' },
      { path: 'retirement.social_security_start_age', label: 'Social Security start age (optional)', kind: 'nullableInt' },
      { path: 'retirement.withdrawal_tax_rate', label: 'Withdrawal tax rate (%, illustrative)', kind: 'percent' },
    ],
  },
  {
    key: 'home',
    title: 'Home purchase',
    nullable: true,
    description: 'Planning estimate only — not a mortgage approval or affordability determination.',
    fields: [
      { path: 'home.enabled', label: 'Include the home purchase', kind: 'bool' },
      { path: 'home.currency', label: 'Currency', kind: 'choice', options: cur },
      { path: 'home.target_price', label: 'Target price', kind: 'money', currencyPath: 'home.currency' },
      { path: 'home.purchase_date', label: 'Purchase date', kind: 'date' },
      { path: 'home.down_payment_pct', label: 'Down payment (%)', kind: 'percent' },
      { path: 'home.closing_cost_pct', label: 'Closing costs (% of price)', kind: 'percent' },
      { path: 'home.prepaid_costs', label: 'Prepaid costs', kind: 'money', currencyPath: 'home.currency' },
      { path: 'home.credits', label: 'Verified credits', kind: 'money', currencyPath: 'home.currency' },
      { path: 'home.mortgage_rate_annual', label: 'Mortgage rate (APR %)', kind: 'percent' },
      { path: 'home.term_years', label: 'Loan term (years)', kind: 'int' },
      { path: 'home.property_tax_rate_annual', label: 'Property tax (%/yr of price)', kind: 'percent' },
      { path: 'home.insurance_annual', label: 'Homeowners insurance per year', kind: 'money', currencyPath: 'home.currency' },
      { path: 'home.hoa_monthly', label: 'HOA per month', kind: 'money', currencyPath: 'home.currency' },
      { path: 'home.pmi_rate_annual', label: 'PMI (%/yr, applies while down payment < 20%)', kind: 'percent' },
      { path: 'home.maintenance_pct_annual', label: 'Maintenance (%/yr of price)', kind: 'percent' },
      { path: 'home.utilities_monthly', label: 'Utilities per month', kind: 'money', currencyPath: 'home.currency' },
      { path: 'home.emergency_reserve', label: 'Emergency reserve to keep', kind: 'money', currencyPath: 'home.currency', helper: 'A required balance, not a closing cost.' },
      { path: 'home.funding_sources.us_cash', label: 'Fund from US cash', kind: 'bool' },
      { path: 'home.funding_sources.brokerage', label: 'Fund from brokerage', kind: 'bool' },
      { path: 'home.funding_sources.rsu_proceeds', label: 'Fund from net RSU sale proceeds', kind: 'bool' },
      { path: 'home.funding_sources.india_liquid', label: 'Fund from India liquid assets (after transfer cost)', kind: 'bool' },
    ],
  },
];

export interface AssumptionsForm {
  values: Record<string, unknown>;
  enabled: { rsu: boolean; retirement_401k: boolean; epf: boolean; home: boolean };
  withdrawal_order: string[];
  notes: string;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
}

/** Default blocks used when a nullable section is switched on without server defaults. */
const EMPTY_SECTIONS = {
  rsu: {
    price_now: '0',
    price_growth_annual: '0',
    strategy: 'sell_on_vest',
    sell_fraction: '0',
    withholding_rate: '0',
    additional_tax_rate: '0',
    annual_refresh_value: '0',
  },
  retirement_401k: { employee_contribution_annual: '0', employer_match_rate: '0', match_up_to_pct_of_salary: '0', contribution_limit_annual: '0', access_age: '59.5' },
  epf: { interest_rate_annual: '0', monthly_contribution: '0', accessible_from_age: null },
};

export function assumptionsToForm(a: ScenarioAssumptions, notes = ''): AssumptionsForm {
  const values: Record<string, unknown> = {};
  const src = {
    ...a,
    rsu: a.rsu ?? EMPTY_SECTIONS.rsu,
    retirement_401k: a.retirement_401k ?? EMPTY_SECTIONS.retirement_401k,
    epf: a.epf ?? EMPTY_SECTIONS.epf,
  } as unknown as Record<string, unknown>;
  for (const s of ASSUMPTION_SECTIONS) {
    for (const f of s.fields) {
      const v = getPath(src, f.path);
      let out: unknown;
      if (f.kind === 'bool') out = !!v;
      else if (v === null || v === undefined) out = '';
      else if (f.kind === 'percent') out = fractionToPercent(String(v));
      else out = String(v);
      setPath(values, f.path, out);
    }
  }
  return {
    values,
    enabled: { rsu: !!a.rsu, retirement_401k: !!a.retirement_401k, epf: !!a.epf, home: !!a.home },
    withdrawal_order: a.retirement?.withdrawal_order?.length ? [...a.retirement.withdrawal_order] : [...WITHDRAWAL_BUCKETS],
    notes,
  };
}

/** Form → contract ScenarioAssumptions (unvalidated). */
export function formToAssumptions(form: AssumptionsForm, base?: ScenarioAssumptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of ASSUMPTION_SECTIONS) {
    if (s.nullable && !form.enabled[s.key as keyof AssumptionsForm['enabled']]) {
      out[s.key] = null;
      continue;
    }
    for (const f of s.fields) {
      const raw = getPath(form.values, f.path);
      let v: unknown;
      const str = typeof raw === 'string' ? raw.trim().replace(/[,\s$₹]/g, '') : raw;
      switch (f.kind) {
        case 'bool':
          v = !!raw;
          break;
        case 'percent':
          v = str === '' ? '' : percentToFraction(String(str)) || String(str);
          break;
        case 'int':
          v = str === '' ? Number.NaN : Number(str);
          break;
        case 'nullableInt':
          v = str === '' ? null : Number(str);
          break;
        default:
          v = typeof raw === 'string' ? (f.kind === 'money' || f.kind === 'decimal' ? String(str) : raw.trim()) : raw;
      }
      setPath(out, f.path, v);
    }
  }
  setPath(out, 'retirement.withdrawal_order', form.withdrawal_order);
  // Preserve any extra server fields we do not edit (forward compatibility).
  return base ? deepMerge(base as unknown as Record<string, unknown>, out) : out;
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) {
      out[k] = deepMerge(a[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Validate with the shared contract schema; returns either assumptions or field errors keyed by path. */
export function validateAssumptions(
  raw: Record<string, unknown>,
): { ok: true; value: ScenarioAssumptions } | { ok: false; errors: Record<string, string> } {
  const res = scenarioAssumptionsSchema.safeParse(raw);
  if (res.success) return { ok: true, value: res.data as ScenarioAssumptions };
  const errors: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = issue.path.join('.');
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}

export function fieldLabel(path: string): string {
  for (const s of ASSUMPTION_SECTIONS) for (const f of s.fields) if (f.path === path) return `${s.title}: ${f.label}`;
  return path;
}

export const WITHDRAWAL_LABELS: Record<string, string> = {
  taxable: 'Taxable accounts',
  india: 'India assets',
  tax_deferred: 'Tax-deferred (pre-tax 401k/IRA)',
  roth: 'Roth',
};
