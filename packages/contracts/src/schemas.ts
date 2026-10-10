/**
 * Zod schemas for every request body in docs/api-contract.md.
 * They validate shape and basic invariants client-side; the API remains authoritative.
 * Money, quantities and rates stay decimal strings end to end.
 */
import { z } from 'zod';

import {
  ACCESSIBILITIES,
  ACCOUNT_KINDS,
  ASSET_TYPES,
  COUNTRIES,
  CURRENCIES,
  DEVICE_PLATFORMS,
  DISPOSITION_KINDS,
  EPF_ACCESS_STATUSES,
  EXPORT_FORMATS,
  EXPORT_SCOPES,
  FD_COMPOUNDINGS,
  GOAL_TYPES,
  LIABILITY_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  RESIDENCY_TYPES,
  RETIREMENT_LOCATIONS,
  RSU_STRATEGIES,
  SCENARIO_KINDS,
  SCENARIO_PRESETS,
  VALUATION_SOURCES,
  VERIFICATION_STATUSES,
  VEST_STATUSES,
  WITHDRAWAL_BUCKETS,
  isAssetType,
  isLiabilityType,
} from './enums';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
const NON_NEGATIVE_DECIMAL_RE = /^\d+(\.\d+)?$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** A decimal string such as "1234.56" or "-0.5". No exponent, no thousands separators. */
export const decimalString = z.string().trim().regex(DECIMAL_RE, 'Enter a number like 1234.56');
/** A decimal string ≥ 0. */
export const nonNegativeDecimal = z
  .string()
  .trim()
  .regex(NON_NEGATIVE_DECIMAL_RE, 'Enter a number of zero or more, like 1234.56');
/** A fractional rate like "0.0625" (6.25%). Must be between 0 and 1 inclusive. */
export const rateDecimal = nonNegativeDecimal.refine((v) => compareDecimal(v, '1') <= 0, {
  message: 'Rates are fractions between 0 and 1 (e.g. 0.0625 for 6.25%)',
});
/** A rate that may be negative (e.g. a return or depreciation assumption), between -1 and 1. */
export const signedRateDecimal = decimalString.refine(
  (v) => compareDecimal(v, '1') <= 0 && compareDecimal(v, '-1') >= 0,
  { message: 'Rates are fractions between -1 and 1 (e.g. -0.02 for −2%)' },
);
/** A positive decimal (> 0). */
export const positiveDecimal = nonNegativeDecimal.refine((v) => compareDecimal(v, '0') > 0, {
  message: 'Must be greater than zero',
});
export const percent100Decimal = nonNegativeDecimal.refine(
  (v) => compareDecimal(v, '100') <= 0 && compareDecimal(v, '0') > 0,
  { message: 'Ownership must be more than 0 and at most 100' },
);

export const isoDate = z
  .string()
  .trim()
  .regex(DATE_RE, 'Use the date format YYYY-MM-DD')
  .refine((v) => isRealDate(v), { message: 'Not a real calendar date' });

export const countrySchema = z.enum(COUNTRIES);
export const reportingCurrencySchema = z.enum(CURRENCIES);
export const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code');

/**
 * Compare two decimal strings exactly (no float conversion). Returns -1, 0 or 1.
 * Inputs must match DECIMAL_RE.
 */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const pa = splitDecimal(a);
  const pb = splitDecimal(b);
  if (pa.zero && pb.zero) return 0;
  if (pa.neg !== pb.neg) {
    if (pa.zero) return pb.neg ? 1 : -1;
    if (pb.zero) return pa.neg ? -1 : 1;
    return pa.neg ? -1 : 1;
  }
  const mag = compareMagnitude(pa, pb);
  return (pa.neg ? -mag : mag) as -1 | 0 | 1;
}

function splitDecimal(v: string) {
  const s = v.trim();
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [intRaw = '0', fracRaw = ''] = body.split('.');
  const int = intRaw.replace(/^0+(?=\d)/, '');
  const frac = fracRaw.replace(/0+$/, '');
  const zero = /^0*$/.test(int) && frac === '';
  return { neg, int, frac, zero };
}

function compareMagnitude(
  a: { int: string; frac: string },
  b: { int: string; frac: string },
): -1 | 0 | 1 {
  if (a.int.length !== b.int.length) return a.int.length > b.int.length ? 1 : -1;
  if (a.int !== b.int) return a.int > b.int ? 1 : -1;
  const len = Math.max(a.frac.length, b.frac.length);
  const fa = a.frac.padEnd(len, '0');
  const fb = b.frac.padEnd(len, '0');
  if (fa === fb) return 0;
  return fa > fb ? 1 : -1;
}

function isRealDate(v: string): boolean {
  const [y, m, d] = v.split('-').map((p) => Number.parseInt(p, 10));
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const taxResidencyPeriodInputSchema = z
  .object({
    jurisdiction: countrySchema,
    residency_type: z.enum(RESIDENCY_TYPES),
    from_date: isoDate,
    to_date: isoDate.nullable(),
    verified_by_user: z.boolean().optional(),
  })
  .refine((p) => p.to_date === null || p.to_date >= p.from_date, {
    message: 'End date must be on or after the start date',
    path: ['to_date'],
  });

export const meUpdateSchema = z
  .object({
    display_name: z.string().trim().min(1).max(100),
    locale: z.string().trim().min(2).max(35),
    timezone: z.string().trim().min(1).max(64),
    reporting_currency: reportingCurrencySchema,
    home_country: countrySchema,
  })
  .partial();

export const onboardingRequestSchema = z.object({
  home_country: countrySchema,
  reporting_currency: reportingCurrencySchema,
  household_name: z.string().trim().min(1, 'Name your household').max(100),
  disclaimer_accepted: z.literal(true, {
    error: 'You must acknowledge that WealthPilot is not tax, legal or investment advice',
  }),
  tax_residency: z.array(taxResidencyPeriodInputSchema).min(1, 'Add at least one tax residency period'),
});

export const taxResidencyReplaceSchema = z.object({
  items: z.array(taxResidencyPeriodInputSchema),
});

export const deleteRequestSchema = z.object({
  confirm: z.literal('DELETE', { error: 'Type DELETE to confirm' }),
});

export const householdUpdateSchema = z
  .object({
    display_name: z.string().trim().min(1).max(100),
    default_currency: reportingCurrencySchema,
  })
  .partial();

// ---------------------------------------------------------------------------
// Accounts and valuations
// ---------------------------------------------------------------------------

export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);

export const initialValuationSchema = z.object({
  amount: nonNegativeDecimal,
  as_of: isoDate,
  verification_status: verificationStatusSchema,
  note: z.string().max(500).optional(),
});

export const retirement401kDetailsSchema = z
  .object({
    pretax_balance: nonNegativeDecimal,
    roth_balance: nonNegativeDecimal,
    employee_contribution_annual: nonNegativeDecimal,
    employee_roth_pct: rateDecimal,
    employer_match_rate: nonNegativeDecimal,
    employer_match_up_to_pct_of_salary: rateDecimal,
    contribution_limit_annual: nonNegativeDecimal,
    access_age: positiveDecimal,
    early_withdrawal_penalty_pct: rateDecimal,
  })
  .partial();

export const iraHsaDetailsSchema = z
  .object({ annual_contribution: nonNegativeDecimal, access_age: positiveDecimal })
  .partial();

export const epfDetailsSchema = z
  .object({
    employee_component: nonNegativeDecimal,
    employer_component: nonNegativeDecimal,
    monthly_employee_contribution: nonNegativeDecimal,
    monthly_employer_contribution: nonNegativeDecimal,
    interest_rate_annual: rateDecimal,
    access_status: z.enum(EPF_ACCESS_STATUSES),
    notes: z.string().max(1000),
  })
  .partial();

export const ppfDetailsSchema = z
  .object({
    annual_contribution: nonNegativeDecimal,
    interest_rate_annual: rateDecimal,
    maturity_date: isoDate,
  })
  .partial();

export const fixedDepositDetailsSchema = z
  .object({
    principal: positiveDecimal,
    start_date: isoDate,
    maturity_date: isoDate,
    interest_rate_annual: rateDecimal,
    compounding: z.enum(FD_COMPOUNDINGS),
    tds_rate: rateDecimal.optional(),
  })
  .refine((d) => d.maturity_date > d.start_date, {
    message: 'Maturity date must be after the start date',
    path: ['maturity_date'],
  });

export const holdingSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
  quantity: nonNegativeDecimal,
  cost_basis: nonNegativeDecimal.optional(),
});

export const investmentDetailsSchema = z
  .object({
    expected_return_annual: signedRateDecimal,
    holdings: z.array(holdingSchema),
  })
  .partial();

export const realEstateDetailsSchema = z
  .object({
    is_primary_residence: z.boolean(),
    rental_income_monthly: nonNegativeDecimal,
    appreciation_annual: signedRateDecimal,
  })
  .partial();

export const liabilityDetailsSchema = z
  .object({
    interest_rate_annual: rateDecimal,
    monthly_payment: nonNegativeDecimal,
    term_months_remaining: z.number().int().min(0).max(600),
  })
  .partial();

/** Returns the details schema for an account type. */
export function detailsSchemaFor(type: string): z.ZodType {
  switch (type) {
    case 'retirement_401k':
      return retirement401kDetailsSchema;
    case 'ira_traditional':
    case 'ira_roth':
    case 'hsa':
      return iraHsaDetailsSchema;
    case 'epf':
      return epfDetailsSchema;
    case 'ppf':
      return ppfDetailsSchema;
    case 'fixed_deposit':
      return fixedDepositDetailsSchema;
    case 'brokerage':
    case 'mutual_fund':
      return investmentDetailsSchema;
    case 'real_estate':
      return realEstateDetailsSchema;
    default:
      if (isLiabilityType(type)) return liabilityDetailsSchema;
      return z.record(z.string(), z.unknown());
  }
}

const accountBaseShape = {
  name: z.string().trim().min(1, 'Give the account a name').max(100),
  country: countrySchema,
  currency: currencyCodeSchema,
  accessibility: z.enum(ACCESSIBILITIES).optional(),
  accessibility_override_note: z.string().trim().max(500).nullable().optional(),
  goal_eligible: z.boolean().optional(),
  include_in_net_worth: z.boolean().optional(),
  ownership_pct: percent100Decimal.optional(),
  details: z.record(z.string(), z.unknown()).optional(),
};

export const accountCreateSchema = z
  .object({
    kind: z.enum(ACCOUNT_KINDS),
    type: z.enum([...ASSET_TYPES, ...LIABILITY_TYPES]),
    ...accountBaseShape,
    initial_valuation: initialValuationSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'asset' && !isAssetType(v.type)) {
      ctx.addIssue({ code: 'custom', message: 'Pick an asset type', path: ['type'] });
    }
    if (v.kind === 'liability' && !isLiabilityType(v.type)) {
      ctx.addIssue({ code: 'custom', message: 'Pick a liability type', path: ['type'] });
    }
    if (v.details) {
      const res = detailsSchemaFor(v.type).safeParse(v.details);
      if (!res.success) {
        for (const issue of res.error.issues) {
          ctx.addIssue({ code: 'custom', message: issue.message, path: ['details', ...issue.path] });
        }
      }
    }
  });

export const accountUpdateSchema = z
  .object({
    type: z.enum([...ASSET_TYPES, ...LIABILITY_TYPES]),
    ...accountBaseShape,
    archived: z.boolean(),
    version: z.number().int().min(1),
  })
  .partial();

export const valuationCreateSchema = z.object({
  amount: nonNegativeDecimal,
  as_of: isoDate,
  verification_status: verificationStatusSchema,
  source: z.enum(VALUATION_SOURCES).optional(),
  note: z.string().max(500).optional(),
  supersedes_id: z.guid().optional(),
});

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

export const fxRateCreateSchema = z
  .object({
    base: currencyCodeSchema,
    quote: currencyCodeSchema,
    rate: positiveDecimal,
    as_of: isoDate,
  })
  .refine((v) => v.base !== v.quote, { message: 'Base and quote must differ', path: ['quote'] });

export const priceCreateSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
  price: positiveDecimal,
  currency: currencyCodeSchema,
  as_of: isoDate,
});

// ---------------------------------------------------------------------------
// RSUs
// ---------------------------------------------------------------------------

export const vestScheduleSchema = z
  .object({
    start_date: isoDate,
    cliff_months: z.number().int().min(0).max(120),
    frequency_months: z.number().int().min(1).max(60),
    total_months: z.number().int().min(1).max(240),
  })
  .refine((s) => s.cliff_months <= s.total_months, {
    message: 'Cliff cannot be longer than the total vesting period',
    path: ['cliff_months'],
  });

export const rsuGrantCreateSchema = z.object({
  employer_name: z.string().trim().min(1, 'Employer is required').max(100),
  symbol: z.string().trim().min(1, 'Ticker symbol is required').max(20),
  grant_date: isoDate,
  granted_shares: positiveDecimal,
  award_currency: currencyCodeSchema,
  grant_price: positiveDecimal.nullable().optional(),
  held_in_account_id: z.guid().nullable().optional(),
  default_withholding_rate: rateDecimal.optional(),
  schedule: vestScheduleSchema.optional(),
});

export const rsuGrantUpdateSchema = z
  .object({
    employer_name: z.string().trim().min(1).max(100),
    symbol: z.string().trim().min(1).max(20),
    grant_date: isoDate,
    granted_shares: positiveDecimal,
    award_currency: currencyCodeSchema,
    grant_price: positiveDecimal.nullable(),
    held_in_account_id: z.guid().nullable(),
    default_withholding_rate: rateDecimal,
    status: z.string(),
    version: z.number().int().min(1),
  })
  .partial();

export const rsuVestCreateSchema = z.object({
  vest_date: isoDate,
  scheduled_shares: positiveDecimal,
  source_event_id: z.string().max(100).optional(),
});

export const rsuVestUpdateSchema = z
  .object({
    status: z.enum(VEST_STATUSES),
    vested_shares: nonNegativeDecimal.nullable(),
    vest_fmv: nonNegativeDecimal.nullable(),
    withheld_shares: nonNegativeDecimal.nullable(),
    version: z.number().int().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.withheld_shares != null && v.vested_shares != null) {
      if (compareDecimal(v.withheld_shares, v.vested_shares) > 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Withheld shares cannot exceed vested shares',
          path: ['withheld_shares'],
        });
      }
    }
    if (v.status === 'vested' && v.vested_shares == null) {
      ctx.addIssue({ code: 'custom', message: 'Enter the shares that vested', path: ['vested_shares'] });
    }
  });

export const rsuDispositionCreateSchema = z.object({
  date: isoDate,
  kind: z.enum(DISPOSITION_KINDS),
  shares: positiveDecimal,
  price: nonNegativeDecimal,
  fees: nonNegativeDecimal.optional(),
});

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export const goalCreateSchema = z.object({
  type: z.enum(GOAL_TYPES),
  name: z.string().trim().min(1, 'Name the goal').max(100),
  target_date: isoDate,
  target_amount: positiveDecimal,
  currency: currencyCodeSchema,
  priority: z.number().int().min(1).max(5),
  scenario_id: z.guid().nullable().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const goalUpdateSchema = z
  .object({
    type: z.enum(GOAL_TYPES),
    name: z.string().trim().min(1).max(100),
    target_date: isoDate,
    target_amount: positiveDecimal,
    currency: currencyCodeSchema,
    priority: z.number().int().min(1).max(5),
    scenario_id: z.guid().nullable(),
    details: z.record(z.string(), z.unknown()),
    version: z.number().int().min(1),
  })
  .partial();

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export const homeAssumptionsSchema = z.object({
  enabled: z.boolean(),
  target_price: positiveDecimal,
  currency: currencyCodeSchema,
  purchase_date: isoDate,
  down_payment_pct: rateDecimal,
  closing_cost_pct: rateDecimal,
  prepaid_costs: nonNegativeDecimal,
  credits: nonNegativeDecimal,
  mortgage_rate_annual: rateDecimal,
  term_years: z.number().int().min(1).max(50),
  property_tax_rate_annual: rateDecimal,
  insurance_annual: nonNegativeDecimal,
  hoa_monthly: nonNegativeDecimal,
  pmi_rate_annual: rateDecimal,
  maintenance_pct_annual: rateDecimal,
  utilities_monthly: nonNegativeDecimal,
  emergency_reserve: nonNegativeDecimal,
  funding_sources: z.object({
    us_cash: z.boolean(),
    brokerage: z.boolean(),
    rsu_proceeds: z.boolean(),
    india_liquid: z.boolean(),
  }),
});

export const scenarioAssumptionsSchema = z
  .object({
    base_date: isoDate,
    reporting_currency: reportingCurrencySchema,
    horizon_years: z.number().int().min(1).max(80),
    household: z.object({
      current_age: z.number().int().min(16).max(110),
      retirement_age: z.number().int().min(16).max(110),
      life_expectancy: z.number().int().min(16).max(120),
    }),
    income: z.object({
      salary_annual: nonNegativeDecimal,
      bonus_annual: nonNegativeDecimal,
      currency: currencyCodeSchema,
      salary_growth_annual: signedRateDecimal,
      effective_tax_rate: rateDecimal,
      living_expenses_monthly: nonNegativeDecimal,
      expense_currency: currencyCodeSchema,
    }),
    returns: z.object({
      us_portfolio_annual: signedRateDecimal,
      india_portfolio_annual: signedRateDecimal,
      cash_annual: signedRateDecimal,
      real_estate_annual: signedRateDecimal,
    }),
    inflation: z.object({
      us_annual: signedRateDecimal,
      india_annual: signedRateDecimal,
    }),
    fx: z.object({
      usd_inr_start: positiveDecimal,
      inr_depreciation_annual: signedRateDecimal,
      transfer_cost_pct: rateDecimal,
    }),
    rsu: z.object({
      price_now: nonNegativeDecimal,
      price_growth_annual: signedRateDecimal,
      strategy: z.enum(RSU_STRATEGIES),
      sell_fraction: rateDecimal,
      withholding_rate: rateDecimal,
      additional_tax_rate: rateDecimal,
      annual_refresh_value: nonNegativeDecimal,
    }),
    retirement_401k: z
      .object({
        employee_contribution_annual: nonNegativeDecimal,
        employer_match_rate: nonNegativeDecimal,
        match_up_to_pct_of_salary: rateDecimal,
        contribution_limit_annual: nonNegativeDecimal,
        access_age: positiveDecimal,
      })
      .nullable(),
    epf: z
      .object({
        interest_rate_annual: rateDecimal,
        monthly_contribution: nonNegativeDecimal,
        accessible_from_age: z.number().int().min(16).max(110).nullable(),
      })
      .nullable(),
    retirement: z.object({
      location: z.enum(RETIREMENT_LOCATIONS),
      spending_monthly_today: nonNegativeDecimal,
      healthcare_monthly_today: nonNegativeDecimal,
      healthcare_inflation_annual: signedRateDecimal,
      social_security_monthly_today: nonNegativeDecimal,
      social_security_start_age: z.number().int().min(50).max(110),
      withdrawal_order: z.array(z.enum(WITHDRAWAL_BUCKETS)).min(1),
      withdrawal_tax_rate: rateDecimal,
    }),
    home: homeAssumptionsSchema.nullable(),
  })
  .superRefine((a, ctx) => {
    if (a.household.retirement_age < a.household.current_age) {
      ctx.addIssue({
        code: 'custom',
        message: 'Retirement age must be at least your current age',
        path: ['household', 'retirement_age'],
      });
    }
    if (a.household.life_expectancy <= a.household.retirement_age) {
      ctx.addIssue({
        code: 'custom',
        message: 'Life expectancy must be after retirement age',
        path: ['household', 'life_expectancy'],
      });
    }
  });

export const scenarioCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name the scenario').max(100),
  kind: z.enum(SCENARIO_KINDS),
  preset: z.enum(SCENARIO_PRESETS),
  goal_id: z.guid().nullable().optional(),
  assumptions: scenarioAssumptionsSchema.optional(),
});

export const scenarioUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    archived: z.boolean(),
    goal_id: z.guid().nullable(),
    version: z.number().int().min(1),
  })
  .partial();

export const scenarioCloneSchema = z.object({
  name: z.string().trim().min(1, 'Name the copy').max(100),
});

export const scenarioVersionCreateSchema = z.object({
  assumptions: scenarioAssumptionsSchema,
  notes: z.string().max(1000).optional(),
});

export const runCreateSchema = z.object({ seed: z.number().int().nullable() });

export const comparisonRequestSchema = z.object({
  run_ids: z.array(z.guid()).min(1, 'Pick at least one run').max(4, 'Compare at most 4 runs'),
});

// ---------------------------------------------------------------------------
// Exports, notifications
// ---------------------------------------------------------------------------

export const exportCreateSchema = z
  .object({
    format: z.enum(EXPORT_FORMATS),
    scope: z.enum(EXPORT_SCOPES),
    run_id: z.guid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.scope === 'run' && !v.run_id) {
      ctx.addIssue({ code: 'custom', message: 'Pick a scenario run to export', path: ['run_id'] });
    }
    if (v.format === 'pdf' && v.scope !== 'run') {
      ctx.addIssue({ code: 'custom', message: 'PDF reports are only available for a scenario run', path: ['format'] });
    }
  });

export const notificationPreferenceSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
});

export const notificationPreferencesUpdateSchema = z.object({
  items: z.array(notificationPreferenceSchema),
});

export const deviceRegistrationSchema = z.object({
  expo_push_token: z.string().min(1),
  platform: z.enum(DEVICE_PLATFORMS),
});
