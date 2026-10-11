'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { analytics, buildGrantCreate, formatDate, grantFormSchema, previewSchedule, todayIso, type GrantForm } from '@wealthpilot/shared';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';

import { FormError, PageHeader } from '@/components/app';
import { DataTable } from '@/components/charts';
import { ChoiceField, DateField, MoneyField, NumberField, PercentField, SwitchField, TextField } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAccounts, useApiMutation } from '@/lib/hooks';
import { qk } from '@/lib/query';

/** New RSU grant with schedule generator (part of S09). */
export function NewGrantPage() {
  const router = useRouter();
  const accounts = useAccounts();
  const brokerages = (accounts.data?.items ?? []).filter((a) => a.type === 'brokerage');
  const { control, handleSubmit } = useForm<GrantForm>({
    resolver: zodResolver(grantFormSchema),
    defaultValues: {
      employer_name: '',
      symbol: '',
      grant_date: todayIso(),
      granted_shares: '',
      award_currency: 'USD',
      grant_price: '',
      withholding_pct: '',
      held_in_account_id: '',
      use_schedule: true,
      start_date: todayIso(),
      cliff_months: '12',
      frequency_months: '3',
      total_months: '48',
    },
  });
  const w = useWatch({ control });
  const preview =
    w.use_schedule && w.granted_shares && /^\d+(\.\d+)?$/.test(w.granted_shares) && /^\d+$/.test(w.frequency_months ?? '') && /^\d+$/.test(w.total_months ?? '') && Number(w.frequency_months) > 0
      ? previewSchedule(w.granted_shares, {
          start_date: w.start_date ?? todayIso(),
          cliff_months: Number(w.cliff_months || 0),
          frequency_months: Number(w.frequency_months),
          total_months: Number(w.total_months),
        })
      : [];

  const create = useApiMutation((api, f: GrantForm) => api.rsu.createGrant(buildGrantCreate(f)), {
    invalidate: [qk.rsuAll, qk.netWorthAll, qk.insightsAll],
    onSuccess: (g) => {
      analytics.track('rsu_grant_created');
      router.replace(`/rsu/${g.id}`);
    },
  });

  return (
    <form data-testid="new-grant" onSubmit={handleSubmit((f) => create.mutate(f))} noValidate>
      <PageHeader title="New RSU grant" back={{ href: '/rsu', label: 'RSU grants' }} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Grant</CardTitle>
          </CardHeader>
          <CardContent className="gap-4">
            <TextField control={control} name="employer_name" label="Employer" />
            <TextField control={control} name="symbol" label="Ticker symbol" />
            <DateField control={control} name="grant_date" label="Grant date" />
            <NumberField control={control} name="granted_shares" label="Shares granted" />
            <ChoiceField
              control={control}
              name="award_currency"
              label="Award currency"
              options={[
                { value: 'USD', label: 'USD' },
                { value: 'INR', label: 'INR' },
              ]}
            />
            <MoneyField control={control} name="grant_price" label="Grant-date reference price (optional)" currency={w.award_currency} />
            <PercentField
              control={control}
              name="withholding_pct"
              label="Default withholding rate (%)"
              helper="Illustrative cash-flow assumption, not your actual payroll withholding or tax liability."
            />
            <ChoiceField
              control={control}
              name="held_in_account_id"
              label="Where do vested shares sit?"
              variant="select"
              helper="If they are held in a brokerage account you track, its balance already includes them, so they are not added again (no double counting)."
              options={[{ value: '', label: 'Not in a tracked account' }, ...brokerages.map((a) => ({ value: a.id, label: a.name }))]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-col">
            <CardTitle>Vest schedule</CardTitle>
            <CardDescription>The server generates the actual schedule; you can edit individual vests afterwards.</CardDescription>
          </CardHeader>
          <CardContent className="gap-4">
            <SwitchField control={control} name="use_schedule" label="Generate a vest schedule" />
            {w.use_schedule ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <DateField control={control} name="start_date" label="Vesting start date" />
                  <NumberField control={control} name="cliff_months" label="Cliff (months)" />
                  <NumberField control={control} name="frequency_months" label="Vest every (months)" />
                  <NumberField control={control} name="total_months" label="Total vesting period (months)" />
                </div>
                {preview.length ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Preview · {preview.length} vests</p>
                    <DataTable
                      caption="Vest schedule preview"
                      columns={['Vest date', 'Shares']}
                      rows={preview.slice(0, 12).map((p) => [formatDate(p.vest_date), p.shares])}
                      testId="schedule-preview"
                    />
                    {preview.length > 12 ? <p className="text-xs text-muted-foreground">…and {preview.length - 12} more</p> : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <div className="mt-6 flex flex-col gap-3">
        <FormError error={create.error} />
        <Button type="submit" loading={create.isPending} className="w-fit" data-testid="create-grant">
          <Check aria-hidden /> Create grant
        </Button>
      </div>
    </form>
  );
}
