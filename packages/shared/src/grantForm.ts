import { rsuGrantCreateSchema, type RsuGrantCreate } from '@wealthpilot/contracts';
import { z } from 'zod';

import { percentToFraction } from './decimal';
import { parseMoneyInput } from './money';

const posNum = (msg: string) => z.string().trim().regex(/^\d+(\.\d+)?$/, msg);
const optNum = z.string().trim().regex(/^(\d+(\.\d+)?)?$/, 'Enter a number');

export const grantFormSchema = z
  .object({
    employer_name: z.string().trim().min(1, 'Employer is required'),
    symbol: z.string().trim().min(1, 'Ticker is required').max(20),
    grant_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    granted_shares: posNum('Enter the number of shares granted'),
    award_currency: z.enum(['USD', 'INR']),
    grant_price: optNum,
    withholding_pct: optNum,
    held_in_account_id: z.string(),
    use_schedule: z.boolean(),
    start_date: z.string(),
    cliff_months: z.string(),
    frequency_months: z.string(),
    total_months: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.use_schedule) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.start_date)) ctx.addIssue({ code: 'custom', path: ['start_date'], message: 'Use YYYY-MM-DD' });
    for (const k of ['cliff_months', 'frequency_months', 'total_months'] as const) {
      if (!/^\d+$/.test(v[k])) ctx.addIssue({ code: 'custom', path: [k], message: 'Whole months' });
    }
    if (/^\d+$/.test(v.frequency_months) && Number(v.frequency_months) < 1) {
      ctx.addIssue({ code: 'custom', path: ['frequency_months'], message: 'At least 1 month' });
    }
    if (/^\d+$/.test(v.cliff_months) && /^\d+$/.test(v.total_months) && Number(v.cliff_months) > Number(v.total_months)) {
      ctx.addIssue({ code: 'custom', path: ['cliff_months'], message: 'Cliff cannot exceed the total vesting period' });
    }
  });

export type GrantForm = z.infer<typeof grantFormSchema>;

export function buildGrantCreate(v: GrantForm): RsuGrantCreate {
  const body: RsuGrantCreate = {
    employer_name: v.employer_name.trim(),
    symbol: v.symbol.trim().toUpperCase(),
    grant_date: v.grant_date,
    granted_shares: v.granted_shares.trim(),
    award_currency: v.award_currency,
    grant_price: v.grant_price.trim() ? parseMoneyInput(v.grant_price) : null,
    held_in_account_id: v.held_in_account_id || null,
    ...(v.withholding_pct.trim() ? { default_withholding_rate: percentToFraction(v.withholding_pct) } : {}),
    ...(v.use_schedule
      ? {
          schedule: {
            start_date: v.start_date,
            cliff_months: Number(v.cliff_months),
            frequency_months: Number(v.frequency_months),
            total_months: Number(v.total_months),
          },
        }
      : {}),
  };
  return rsuGrantCreateSchema.parse(body) as RsuGrantCreate;
}
