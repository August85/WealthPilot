import {
  ACCESSIBILITIES,
  ACCOUNT_KINDS,
  ASSET_TYPES,
  COUNTRIES,
  CURRENCIES,
  LIABILITY_TYPES,
  VERIFICATION_STATUSES,
  accountCreateSchema,
  compareDecimal,
  type AccountCreate,
  type AccountType,
} from '@wealthpilot/contracts';
import { z } from 'zod';

import { defaultAccessibility, templateFor } from './catalog';
import { sumDec } from './decimal';
import { todayIso } from './dates';
import { parseMoneyInput } from './money';

import { defaultDetailValues, detailsToPayload, validateDetails } from './detailFields';

const amountRe = /^[\s$₹,\d.]*$/;

/** S05 form model. Everything is a string/boolean; conversion to the contract happens in buildAccountCreate. */
export const addAccountFormSchema = z
  .object({
    kind: z.enum(ACCOUNT_KINDS),
    type: z.enum([...ASSET_TYPES, ...LIABILITY_TYPES]),
    name: z.string().trim().min(1, 'Give the account a name').max(100),
    country: z.enum(COUNTRIES),
    currency: z.enum(CURRENCIES),
    ownership_pct: z.string().trim(),
    accessibility: z.enum(ACCESSIBILITIES),
    accessibility_override_note: z.string(),
    goal_eligible: z.boolean(),
    include_in_net_worth: z.boolean(),
    amount: z.string().regex(amountRe, 'Enter an amount like 10000.00 (no minus sign)'),
    as_of: z.string(),
    verification_status: z.enum(VERIFICATION_STATUSES),
    valuation_note: z.string().max(500),
    details: z.record(z.string(), z.union([z.string(), z.boolean()])),
  })
  .superRefine((v, ctx) => {
    const own = v.ownership_pct.replace('%', '').trim();
    if (!/^\d+(\.\d+)?$/.test(own) || compareDecimal(own, '0') <= 0 || compareDecimal(own, '100') > 0) {
      ctx.addIssue({ code: 'custom', path: ['ownership_pct'], message: 'Ownership must be more than 0 and at most 100' });
    }
    if (v.kind === 'asset' && v.accessibility !== defaultAccessibility(v.type as AccountType) && !v.accessibility_override_note.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['accessibility_override_note'],
        message: 'Explain why you changed the default accessibility (kept as an audit note)',
      });
    }
    if (v.amount.trim() !== '') {
      if (v.amount.includes('-')) {
        ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Amounts are never negative. Enter debts as a liability.' });
      } else if (parseMoneyInput(v.amount) === null) {
        ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Enter an amount like 10000.00' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.as_of.trim())) {
        ctx.addIssue({ code: 'custom', path: ['as_of'], message: 'Use the date format YYYY-MM-DD' });
      }
    }
    const detailErrors = validateDetails(v.type, v.details);
    for (const [key, message] of Object.entries(detailErrors)) {
      ctx.addIssue({ code: 'custom', path: ['details', key], message });
    }
  });

export type AddAccountForm = z.infer<typeof addAccountFormSchema>;

export function defaultAddAccountValues(type: AccountType): AddAccountForm {
  const tpl = templateFor(type);
  const accessibility = defaultAccessibility(type);
  return {
    kind: tpl?.kind ?? 'asset',
    type,
    name: tpl?.label ?? '',
    country: tpl?.country ?? 'US',
    currency: tpl?.currency ?? 'USD',
    ownership_pct: '100',
    accessibility,
    accessibility_override_note: '',
    goal_eligible: tpl?.kind === 'liability' ? false : accessibility === 'liquid',
    include_in_net_worth: true,
    amount: '',
    as_of: todayIso(),
    verification_status: 'estimated',
    valuation_note: '',
    details: defaultDetailValues(type),
  };
}

/** 401(k) valuation = pre-tax + Roth (FR-RET-002: kept distinct, summed only for the account total). */
export function suggested401kTotal(details: Record<string, string | boolean>): string | null {
  const pre = typeof details.pretax_balance === 'string' ? details.pretax_balance : '';
  const roth = typeof details.roth_balance === 'string' ? details.roth_balance : '';
  if (!pre.trim() && !roth.trim()) return null;
  const a = parseMoneyInput(pre || '0');
  const b = parseMoneyInput(roth || '0');
  if (a === null || b === null) return null;
  return sumDec([a, b]).toFixed(2);
}

/** Convert the form into the contract body. Validates the result against the shared Zod schema. */
export function buildAccountCreate(v: AddAccountForm): AccountCreate {
  const isAsset = v.kind === 'asset';
  const body: AccountCreate = {
    kind: v.kind,
    type: v.type,
    name: v.name.trim(),
    country: v.country,
    currency: v.currency,
    ownership_pct: v.ownership_pct.replace('%', '').trim(),
    include_in_net_worth: v.include_in_net_worth,
    details: detailsToPayload(v.type, v.details) as AccountCreate['details'],
  };
  if (isAsset) {
    body.accessibility = v.accessibility;
    body.goal_eligible = v.goal_eligible;
    if (v.accessibility !== defaultAccessibility(v.type as AccountType)) {
      body.accessibility_override_note = v.accessibility_override_note.trim();
    }
  }
  const amount = v.amount.trim() ? parseMoneyInput(v.amount) : null;
  if (amount !== null) {
    body.initial_valuation = {
      amount,
      as_of: v.as_of.trim(),
      verification_status: v.verification_status,
      ...(v.valuation_note.trim() ? { note: v.valuation_note.trim() } : {}),
    };
  }
  return accountCreateSchema.parse(body) as AccountCreate;
}
