import { useFieldArray } from 'react-hook-form';
import { z } from 'zod';

import { COUNTRIES, CURRENCIES, RESIDENCY_TYPES, isoDate } from '@wealthpilot/contracts';

import { ChoiceField, DateField, SwitchField, type FormControl } from '@/components/form';
import { Button, Card, Row, Stack, Text } from '@/components/primitives';
import { COUNTRY_LABELS, RESIDENCY_LABELS } from '@/lib/catalog';

/** Form model shared by onboarding (S03) and the profile residency editor. Empty to_date = ongoing. */
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

export function ResidencyPeriodsEditor({ control }: { control: FormControl<ResidencyFormInput> }) {
  const { fields, append, remove } = useFieldArray({ control, name: 'tax_residency' });
  return (
    <Stack gap={12}>
      {fields.map((f, i) => (
        <Card key={f.id} testID={`residency-period-${i}`}>
          <Row>
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              Period {i + 1}
            </Text>
            {fields.length > 1 ? (
              <Button
                compact
                variant="ghost"
                label="Remove"
                icon="trash-outline"
                accessibilityLabel={`Remove period ${i + 1}`}
                onPress={() => remove(i)}
              />
            ) : null}
          </Row>
          <ChoiceField
            control={control}
            name={`tax_residency.${i}.jurisdiction`}
            label="Jurisdiction"
            options={COUNTRIES.map((c) => ({ value: c, label: COUNTRY_LABELS[c] }))}
          />
          <ChoiceField
            control={control}
            name={`tax_residency.${i}.residency_type`}
            label="Residency status (your assumption)"
            options={RESIDENCY_TYPES.map((r) => ({ value: r, label: RESIDENCY_LABELS[r] }))}
          />
          <DateField control={control} name={`tax_residency.${i}.from_date`} label="From" />
          <DateField control={control} name={`tax_residency.${i}.to_date`} label="To (leave empty if ongoing)" helper="YYYY-MM-DD or empty" />
          <SwitchField
            control={control}
            name={`tax_residency.${i}.verified_by_user`}
            label="I have confirmed this status"
            helper="WealthPilot does not determine tax residency. Confirm with a professional."
          />
        </Card>
      ))}
      <Button label="Add another period" icon="add" variant="secondary" onPress={() => append(emptyPeriod())} />
    </Stack>
  );
}
