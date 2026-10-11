'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import type { Me, TaxResidencyPeriod } from '@wealthpilot/contracts';
import { emptyPeriod, residencyFormSchema, type ResidencyFormInput, type ResidencyFormOutput } from '@wealthpilot/shared';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { FormError, PageHeader, QueryView } from '@/components/app';
import { Disclaimer } from '@/components/finance/finance';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/api';
import { useApiMutation, useMe } from '@/lib/hooks';
import { qk } from '@/lib/query';

import { ResidencyPeriodsEditor } from '../onboarding/ResidencyForm';

/** Tax residency periods: GET/PUT /me/tax-residency. The whole list is replaced on save. */
export function ResidencySettingsPage() {
  const api = useApi();
  const me = useMe();
  const periods = useQuery({ queryKey: qk.taxResidency, queryFn: ({ signal }) => api.me.getTaxResidency({ signal }) });
  return (
    <div data-testid="residency-settings" className="max-w-3xl">
      <PageHeader
        title="Tax residency"
        back={{ href: '/settings', label: 'Settings' }}
        description="These periods are your own assumption and drive which rules a scenario illustrates. WealthPilot does not determine your residency."
      />
      <QueryView query={periods} loadingLabel="Loading residency">
        {(data) => (me.data ? <ResidencyEditor me={me.data} items={data.items} /> : null)}
      </QueryView>
      <Disclaimer compact className="mt-6" />
    </div>
  );
}

function ResidencyEditor({ me, items }: { me: Me; items: TaxResidencyPeriod[] }) {
  const router = useRouter();
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
    onSuccess: () => {
      toast.success('Residency saved');
      router.push('/settings');
    },
  });
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
      <ResidencyPeriodsEditor control={control} />
      <FormError error={save.error} />
      <Button type="submit" loading={save.isPending} data-testid="save-residency" className="w-fit">
        <Check aria-hidden /> Save residency
      </Button>
    </form>
  );
}
