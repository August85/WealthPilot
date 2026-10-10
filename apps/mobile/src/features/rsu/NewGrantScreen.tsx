import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useForm, useWatch } from 'react-hook-form';

import { FormError, MutationButton } from '@/components/app';
import { ChoiceField, DateField, MoneyField, PercentField, SwitchField, TextField } from '@/components/form';
import { Card, Screen, Stack, Text } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import { formatDate, todayIso } from '@/lib/dates';
import { useAccounts, useApiMutation } from '@/lib/hooks';
import { qk } from '@/lib/query';

import { buildGrantCreate, grantFormSchema, type GrantForm } from './grantForm';
import { previewSchedule } from './schedule';

/** New RSU grant with schedule generator (part of S09). */
export default function NewGrantScreen() {
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
    w.use_schedule && w.granted_shares && /^\d+$/.test(w.frequency_months ?? '') && /^\d+$/.test(w.total_months ?? '')
      ? previewSchedule(w.granted_shares, {
          start_date: w.start_date ?? todayIso(),
          cliff_months: Number(w.cliff_months || 0),
          frequency_months: Number(w.frequency_months),
          total_months: Number(w.total_months),
        })
      : [];

  const create = useApiMutation((api, f: GrantForm) => api.rsu.createGrant(buildGrantCreate(f)), {
    invalidate: [qk.grants, ['rsu'], qk.netWorthAll],
    onSuccess: (g) => {
      analytics.track('rsu_grant_created');
      router.replace(`/rsu/${g.id}`);
    },
  });

  return (
    <Screen testID="new-grant">
      <Text variant="title">New RSU grant</Text>
      <TextField control={control} name="employer_name" label="Employer" />
      <TextField control={control} name="symbol" label="Ticker symbol" autoCapitalize="characters" />
      <DateField control={control} name="grant_date" label="Grant date" />
      <TextField control={control} name="granted_shares" label="Shares granted" keyboardType="decimal-pad" />
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
        helper="If they are held in a brokerage account you track, its balance already includes them, so they are not added again (no double counting)."
        options={[{ value: '', label: 'Not in a tracked account' }, ...brokerages.map((a) => ({ value: a.id, label: a.name }))]}
      />
      <Card>
        <SwitchField control={control} name="use_schedule" label="Generate a vest schedule" />
        {w.use_schedule ? (
          <Stack gap={12}>
            <DateField control={control} name="start_date" label="Vesting start date" />
            <TextField control={control} name="cliff_months" label="Cliff (months)" keyboardType="number-pad" />
            <TextField control={control} name="frequency_months" label="Vest every (months)" keyboardType="number-pad" />
            <TextField control={control} name="total_months" label="Total vesting period (months)" keyboardType="number-pad" />
            {preview.length ? (
              <Stack gap={4} >
                <Text variant="label">Preview ({preview.length} vests — the server generates the actual schedule)</Text>
                {preview.slice(0, 8).map((p) => (
                  <Text key={p.vest_date} variant="caption" tabular>
                    {formatDate(p.vest_date)} — {p.shares} shares
                  </Text>
                ))}
                {preview.length > 8 ? (
                  <Text variant="caption" tone="muted">
                    …and {preview.length - 8} more
                  </Text>
                ) : null}
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </Card>
      <FormError error={create.error} />
      <MutationButton label="Create grant" icon="checkmark" loading={create.isPending} onPress={handleSubmit((f) => create.mutate(f))} />
    </Screen>
  );
}
