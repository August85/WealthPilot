import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useForm } from 'react-hook-form';

import type { Me, TaxResidencyPeriod } from '@wealthpilot/contracts';

import { FormError, MutationButton, QueryView } from '@/components/app';
import { Disclaimer } from '@/components/finance';
import { Screen, Text } from '@/components/primitives';
import { useApi } from '@/lib/api';
import { useApiMutation, useMe } from '@/lib/hooks';
import { qk } from '@/lib/query';

import {
  ResidencyPeriodsEditor,
  emptyPeriod,
  residencyFormSchema,
  type ResidencyFormInput,
  type ResidencyFormOutput,
} from '../onboarding/ResidencyForm';

/** Tax residency periods (profile): GET/PUT /me/tax-residency. The whole list is replaced on save. */
export default function ResidencySettingsScreen() {
  const api = useApi();
  const me = useMe();
  const periods = useQuery({ queryKey: qk.taxResidency, queryFn: ({ signal }) => api.me.getTaxResidency({ signal }) });
  return (
    <Screen testID="residency-settings">
      <Text variant="title">Tax residency</Text>
      <Text tone="muted">
        These periods are your own assumption and drive which rules a scenario illustrates. WealthPilot does not
        determine your residency.
      </Text>
      <QueryView query={periods} loadingLabel="Loading residency">
        {(data) => (me.data ? <ResidencyEditor me={me.data} items={data.items} /> : null)}
      </QueryView>
      <Disclaimer compact />
    </Screen>
  );
}

function ResidencyEditor({ me, items }: { me: Me; items: TaxResidencyPeriod[] }) {
  const { control, handleSubmit } = useForm<ResidencyFormInput, unknown, ResidencyFormOutput>({
    resolver: zodResolver(residencyFormSchema),
    defaultValues: {
      home_country: me.home_country ?? 'US',
      reporting_currency: me.reporting_currency,
      // Already accepted at onboarding; the shared schema still requires it.
      disclaimer_accepted: true,
      tax_residency: items.length
        ? items.map((p) => ({
            jurisdiction: p.jurisdiction,
            residency_type: p.residency_type,
            from_date: p.from_date,
            to_date: p.to_date ?? '',
            verified_by_user: p.verified_by_user,
          }))
        : [emptyPeriod()],
    },
  });
  const save = useApiMutation((a, v: ResidencyFormOutput) => a.me.replaceTaxResidency(v.tax_residency), {
    invalidate: [qk.taxResidency],
    onSuccess: () => router.back(),
  });
  return (
    <>
      <ResidencyPeriodsEditor control={control} />
      <MutationButton
        label="Save residency"
        icon="checkmark"
        loading={save.isPending}
        onPress={handleSubmit((v) => save.mutate(v))}
        testID="save-residency"
      />
      <FormError error={save.error} />
    </>
  );
}
