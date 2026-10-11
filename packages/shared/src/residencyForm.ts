/** Form model shared by onboarding (S03) and the profile residency editor. Empty to_date = ongoing. */
import { COUNTRIES, CURRENCIES, RESIDENCY_TYPES, isoDate } from '@wealthpilot/contracts';
import { z } from 'zod';

export const residencyPeriodFormSchema = z
  .object({
    jurisdiction: z.enum(COUNTRIES),
    residency_type: z.enum(RESIDENCY_TYPES),
    from_date: isoDate,
    to_date: z.union([z.literal(''), isoDate]),
    verified_by_user: z.boolean(),
  })
  .refine((p) => p.to_date === '' || p.to_date >= p.from_date, {
    message: 'End date must be on or after the start date',
    path: ['to_date'],
  })
  .transform((p) => ({ ...p, to_date: p.to_date === '' ? null : p.to_date }));

export const residencyFormSchema = z.object({
  home_country: z.enum(COUNTRIES),
  reporting_currency: z.enum(CURRENCIES),
  tax_residency: z.array(residencyPeriodFormSchema).min(1, 'Add at least one tax residency period'),
  disclaimer_accepted: z.boolean().refine((v) => v === true, {
    message: 'Please confirm you understand WealthPilot is not tax, legal or investment advice',
  }),
});

export type ResidencyFormInput = z.input<typeof residencyFormSchema>;
export type ResidencyFormOutput = z.output<typeof residencyFormSchema>;

export const emptyPeriod = (): ResidencyFormInput['tax_residency'][number] => ({
  jurisdiction: 'US',
  residency_type: 'resident',
  from_date: '',
  to_date: '',
  verified_by_user: false,
});

export const householdFormSchema = z.object({
  household_name: z.string().trim().min(1, 'Name your household').max(100),
});
