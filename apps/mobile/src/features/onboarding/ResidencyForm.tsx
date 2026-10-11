import { useFieldArray } from 'react-hook-form';

import { COUNTRIES, RESIDENCY_TYPES } from '@wealthpilot/contracts';
import { emptyPeriod, type ResidencyFormInput } from '@wealthpilot/shared';

import { ChoiceField, DateField, SwitchField, type FormControl } from '@/components/form';
import { Button, Card, Row, Stack, Text } from '@/components/primitives';
import { COUNTRY_LABELS, RESIDENCY_LABELS } from '@/lib/catalog';

/** Form model (shared with the web app): onboarding (S03) and the profile residency editor. */
export {
  emptyPeriod,
  residencyFormSchema,
  residencyPeriodFormSchema,
  type ResidencyFormInput,
  type ResidencyFormOutput,
} from '@wealthpilot/shared';

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
