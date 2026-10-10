import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';

import { COUNTRIES, CURRENCIES } from '@wealthpilot/contracts';

import { ChoiceField, SwitchRow } from '@/components/form';
import { Disclaimer } from '@/components/finance';
import { Button, Card, Screen, Text } from '@/components/primitives';
import { COUNTRY_LABELS } from '@/lib/catalog';

import { useOnboardingDraft } from './draft';
import {
  ResidencyPeriodsEditor,
  emptyPeriod,
  residencyFormSchema,
  type ResidencyFormInput,
  type ResidencyFormOutput,
} from './ResidencyForm';

/** S03 Onboarding residency: home country, reporting currency, tax residency periods, not-advice acknowledgement. */
export default function ResidencyScreen() {
  const setResidency = useOnboardingDraft((s) => s.setResidency);
  const existing = useOnboardingDraft((s) => s.residency);
  const { control, handleSubmit } = useForm<ResidencyFormInput, unknown, ResidencyFormOutput>({
    resolver: zodResolver(residencyFormSchema),
    defaultValues: existing
      ? {
          ...existing,
          tax_residency: existing.tax_residency.map((p) => ({ ...p, to_date: p.to_date ?? '', verified_by_user: !!p.verified_by_user })),
        }
      : {
          home_country: 'US',
          reporting_currency: 'USD',
          tax_residency: [emptyPeriod()],
          disclaimer_accepted: false,
        },
  });

  const onNext = handleSubmit((v) => {
    setResidency(v);
    router.push('/onboarding/household');
  });

  return (
    <Screen testID="onboarding-residency">
      <Text variant="title">Where are you based?</Text>
      <Text tone="muted">
        This sets your defaults. Tax residency here is your own assumption — WealthPilot does not decide it.
      </Text>
      <ChoiceField
        control={control}
        name="home_country"
        label="Home country"
        options={COUNTRIES.map((c) => ({ value: c, label: COUNTRY_LABELS[c] }))}
      />
      <ChoiceField
        control={control}
        name="reporting_currency"
        label="Reporting currency"
        helper="You can switch between USD and INR at any time; balances keep their own currency."
        options={CURRENCIES.map((c) => ({ value: c, label: c === 'USD' ? '$ US dollar' : '₹ Indian rupee' }))}
      />
      <Text variant="heading">Tax residency periods</Text>
      <ResidencyPeriodsEditor control={control} />
      <Disclaimer />
      <Controller
        control={control}
        name="disclaimer_accepted"
        render={({ field, fieldState }) => (
          <Card tone={fieldState.error ? 'danger' : 'default'}>
            <SwitchRow
              testID="disclaimer-switch"
              label="I understand WealthPilot is not tax, legal or investment advice"
              helper="Required to continue."
              value={!!field.value}
              onValueChange={field.onChange}
            />
            {fieldState.error ? (
              <Text tone="danger" variant="caption" accessibilityRole="alert">
                ⚠ {fieldState.error.message}
              </Text>
            ) : null}
          </Card>
        )}
      />
      <Button label="Continue" icon="arrow-forward" onPress={onNext} testID="residency-continue" />
    </Screen>
  );
}
