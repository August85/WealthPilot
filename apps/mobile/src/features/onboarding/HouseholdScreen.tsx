import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormError, MutationButton } from '@/components/app';
import { TextField } from '@/components/form';
import { Card, Icon, Row, Screen, Text } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import { useApiMutation } from '@/lib/hooks';
import { qk } from '@/lib/query';

import { useOnboardingDraft } from './draft';

const schema = z.object({ household_name: z.string().trim().min(1, 'Name your household').max(100) });

/** S04 Household setup: name + single-user note. Submits POST /me/onboarding with S03's answers. */
export default function HouseholdScreen() {
  const residency = useOnboardingDraft((s) => s.residency);
  const clear = useOnboardingDraft((s) => s.clear);
  const qc = useQueryClient();
  const { control, handleSubmit } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { household_name: 'Our household' },
  });
  const onboard = useApiMutation(
    (api, name: string) => {
      if (!residency) throw new Error('Residency step not completed');
      return api.me.onboard({
        home_country: residency.home_country,
        reporting_currency: residency.reporting_currency,
        household_name: name,
        disclaimer_accepted: true,
        tax_residency: residency.tax_residency,
      });
    },
    {
      onSuccess: (me) => {
        qc.setQueryData(qk.me, me);
        clear();
        analytics.track('onboarding_completed', { currency: me.reporting_currency });
      },
    },
  );

  if (!residency) return <Redirect href="/onboarding/residency" />;

  return (
    <Screen testID="onboarding-household">
      <Text variant="title">Name your household</Text>
      <TextField control={control} name="household_name" label="Household name" />
      <Card tone="info">
        <Row gap={8}>
          <Icon name="person-outline" />
          <Text style={{ flex: 1 }}>
            For now a household has a single member — you. Sharing with a partner (with private accounts kept private)
            is planned for a later release.
          </Text>
        </Row>
      </Card>
      <FormError error={onboard.error} />
      <MutationButton
        label="Finish setup"
        icon="checkmark"
        loading={onboard.isPending}
        onPress={handleSubmit((v) => onboard.mutate(v.household_name))}
        testID="household-finish"
      />
    </Screen>
  );
}
