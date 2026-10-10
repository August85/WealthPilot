import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { ACCESSIBILITIES, compareDecimal, type Account, type Valuation } from '@wealthpilot/contracts';

import { FormError, MutationButton, QueryView } from '@/components/app';
import { ProjectionChart } from '@/components/charts';
import { ChoiceField, DateField, MoneyField, SwitchField, TextField } from '@/components/form';
import { BalanceCard, KeyValue, Pill, ProvenancePill } from '@/components/finance';
import { Money } from '@/components/Money';
import { Button, Card, Divider, Row, Screen, SectionHeader, Stack, Text } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import { ACCESSIBILITY_LABELS, COUNTRY_LABELS, defaultAccessibility, typeLabel } from '@/lib/catalog';
import { formatDate, formatTimestamp, todayIso } from '@/lib/dates';
import { useAccount, useApiMutation, useValuations } from '@/lib/hooks';
import { parseMoneyInput } from '@/lib/money';
import { qk } from '@/lib/query';

const valuationFormSchema = z.object({
  amount: z
    .string()
    .refine((v) => !v.includes('-'), 'Amounts are never negative. Liabilities are entered as the positive amount owed.')
    .refine((v) => parseMoneyInput(v) !== null, 'Enter an amount like 10000.00'),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  verification_status: z.enum(['estimated', 'verified']),
  note: z.string().max(500),
});
type ValuationForm = z.infer<typeof valuationFormSchema>;

/** S08 Account detail: valuation history chart, append valuation, traceable corrections. */
export default function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const account = useAccount(id);
  return (
    <Screen testID="account-detail">
      <QueryView query={account} loadingLabel="Loading account">
        {(a) => <AccountDetail account={a} />}
      </QueryView>
    </Screen>
  );
}

function AccountDetail({ account: a }: { account: Account }) {
  const valuations = useValuations(a.id);
  const [correcting, setCorrecting] = useState<Valuation | null>(null);
  const [editing, setEditing] = useState(false);
  const v = a.latest_valuation;

  return (
    <Stack gap={16}>
      <View>
        <Text variant="title">{a.name}</Text>
        <Text tone="muted">
          {typeLabel(a.type)} · {COUNTRY_LABELS[a.country]} · {a.currency} · {a.kind === 'liability' ? 'Liability' : ACCESSIBILITY_LABELS[a.accessibility]}
        </Text>
        {a.archived ? <Pill icon="archive-outline" text="Archived" /> : null}
      </View>
      <BalanceCard
        title={a.kind === 'liability' ? 'Amount owed' : 'Latest balance'}
        amount={v?.amount ?? null}
        currency={a.currency}
        verification={v?.verification_status ?? null}
        stale={a.stale}
        asOf={v?.as_of ?? null}
        variant="title">
        {a.ownership_pct !== '100' ? (
          <Text variant="caption" tone="muted">
            You own {a.ownership_pct}% — net worth counts your share only.
          </Text>
        ) : null}
        {a.stale ? (
          <Text variant="caption" tone="warning">
            ⏱ Stale: last valuation is older than 45 days (or missing). Add a new valuation below.
          </Text>
        ) : null}
      </BalanceCard>

      {a.type === 'epf' ? (
        <Button label="Edit EPF details" icon="business-outline" variant="secondary" onPress={() => router.push(`/epf/${a.id}`)} />
      ) : null}

      <QueryView query={valuations} loadingLabel="Loading history">
        {(data) => <ValuationHistory account={a} items={data.items} onCorrect={setCorrecting} />}
      </QueryView>

      <AppendValuation account={a} correcting={correcting} onDone={() => setCorrecting(null)} />

      <Card>
        <SectionHeader
          title="Settings"
          action={<Button compact variant="ghost" label={editing ? 'Close' : 'Edit'} onPress={() => setEditing((e) => !e)} />}
        />
        {editing ? (
          <EditAccount account={a} onDone={() => setEditing(false)} />
        ) : (
          <Stack gap={4}>
            <KeyValue label="Accessibility">{ACCESSIBILITY_LABELS[a.accessibility]}</KeyValue>
            {a.accessibility_override_note ? <KeyValue label="Override note">{a.accessibility_override_note}</KeyValue> : null}
            <KeyValue label="Can fund goals">{a.goal_eligible ? 'Yes' : 'No'}</KeyValue>
            <KeyValue label="In net worth">{a.include_in_net_worth ? 'Yes' : 'No'}</KeyValue>
            <KeyValue label="Ownership">{`${a.ownership_pct}%`}</KeyValue>
            <KeyValue label="Version">{String(a.version)}</KeyValue>
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

function ValuationHistory({
  account: a,
  items,
  onCorrect,
}: {
  account: Account;
  items: Valuation[];
  onCorrect: (v: Valuation) => void;
}) {
  const effective = items.filter((v) => !v.superseded_by).sort((x, y) => x.as_of.localeCompare(y.as_of));
  return (
    <Card testID="valuation-history">
      <Text variant="heading">Valuation history</Text>
      <Text variant="caption" tone="muted">
        Append-only. Corrections add a new entry that supersedes the old one; nothing is overwritten.
      </Text>
      {effective.length >= 2 ? (
        <ProjectionChart
          title="Balance over time"
          xLabels={effective.map((v) => formatDate(v.as_of))}
          series={[{ key: 'balance', label: a.kind === 'liability' ? 'Owed' : 'Balance', values: effective.map((v) => v.amount) }]}
          currency={a.currency}
          testID="valuation-chart"
        />
      ) : null}
      {items.length === 0 ? <Text tone="muted">No valuations yet.</Text> : null}
      {items.map((v) => (
        <View key={v.id} style={styles.valRow} accessible={false}>
          <Row>
            <View style={styles.flex}>
              <Money value={v.amount} currency={v.currency} variant="bodyStrong" strike={!!v.superseded_by} qualifier={v.superseded_by ? 'superseded' : undefined} />
              <ProvenancePill verification={v.verification_status} asOf={v.as_of} source={v.source} />
              {v.superseded_by ? <Pill icon="git-commit-outline" text="Superseded by a correction" /> : null}
              {v.supersedes_id ? <Pill icon="build-outline" text="Correction" kind="accent" /> : null}
              {v.note ? (
                <Text variant="caption" tone="muted">
                  “{v.note}”
                </Text>
              ) : null}
              <Text variant="caption" tone="muted">
                Recorded {formatTimestamp(v.created_at)}
              </Text>
            </View>
            {!v.superseded_by ? (
              <Button compact variant="ghost" label="Correct" accessibilityLabel={`Correct valuation from ${formatDate(v.as_of)}`} onPress={() => onCorrect(v)} />
            ) : null}
          </Row>
          <Divider />
        </View>
      ))}
    </Card>
  );
}

function AppendValuation({
  account: a,
  correcting,
  onDone,
}: {
  account: Account;
  correcting: Valuation | null;
  onDone: () => void;
}) {
  const { control, handleSubmit, reset } = useForm<ValuationForm>({
    resolver: zodResolver(valuationFormSchema),
    values: correcting
      ? { amount: correcting.amount, as_of: correcting.as_of, verification_status: correcting.verification_status, note: '' }
      : { amount: '', as_of: todayIso(), verification_status: 'verified', note: '' },
  });
  const add = useApiMutation(
    (api, f: ValuationForm) =>
      api.accounts.addValuation(a.id, {
        amount: parseMoneyInput(f.amount)!,
        as_of: f.as_of,
        verification_status: f.verification_status,
        source: 'manual',
        ...(f.note.trim() ? { note: f.note.trim() } : {}),
        ...(correcting ? { supersedes_id: correcting.id } : {}),
      }),
    {
      invalidate: [qk.valuations(a.id), qk.account(a.id), qk.accountsAll, qk.netWorthAll, ['insights'], qk.goals],
      onSuccess: () => {
        analytics.track('valuation_added', { account_type: a.type });
        reset();
        onDone();
      },
    },
  );
  return (
    <Card testID="append-valuation">
      <Text variant="heading">{correcting ? `Correct entry from ${formatDate(correcting.as_of)}` : 'Add a valuation'}</Text>
      {correcting ? (
        <Text variant="caption" tone="muted">
          The original entry stays in history, marked as superseded.
        </Text>
      ) : null}
      <MoneyField control={control} name="amount" label={a.kind === 'liability' ? 'Amount owed' : 'Balance'} currency={a.currency} />
      <DateField control={control} name="as_of" label="As of" />
      <ChoiceField
        control={control}
        name="verification_status"
        label="Status"
        options={[
          { value: 'verified', label: 'Verified' },
          { value: 'estimated', label: 'Estimated' },
        ]}
      />
      <TextField control={control} name="note" label={correcting ? 'Reason for correction' : 'Note (optional)'} multiline />
      <FormError error={add.error} />
      <MutationButton
        label={correcting ? 'Save correction' : 'Add valuation'}
        icon="add"
        onPress={handleSubmit((f) => add.mutate(f))}
        loading={add.isPending}
        testID="save-valuation"
      />
      {correcting ? <Button label="Cancel correction" variant="ghost" onPress={onDone} /> : null}
    </Card>
  );
}

const editSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    ownership_pct: z.string().refine(
      (v) => /^\d+(\.\d+)?$/.test(v) && compareDecimal(v, '0') > 0 && compareDecimal(v, '100') <= 0,
      'Ownership must be more than 0 and at most 100',
    ),
    accessibility: z.enum(ACCESSIBILITIES),
    accessibility_override_note: z.string(),
    goal_eligible: z.boolean(),
    include_in_net_worth: z.boolean(),
    type: z.string(),
  })
  .refine((v) => v.accessibility === defaultAccessibility(v.type as Account['type']) || v.accessibility_override_note.trim() !== '', {
    path: ['accessibility_override_note'],
    message: 'Explain why you changed the default accessibility',
  });
type EditForm = z.infer<typeof editSchema>;

function EditAccount({ account: a, onDone }: { account: Account; onDone: () => void }) {
  const { control, handleSubmit } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: a.name,
      ownership_pct: a.ownership_pct,
      accessibility: a.accessibility,
      accessibility_override_note: a.accessibility_override_note ?? '',
      goal_eligible: a.goal_eligible,
      include_in_net_worth: a.include_in_net_worth,
      type: a.type,
    },
  });
  const update = useApiMutation(
    (api, body: Parameters<typeof api.accounts.update>[1]) => api.accounts.update(a.id, body),
    {
      invalidate: [qk.account(a.id), qk.accountsAll, qk.netWorthAll],
      onSuccess: onDone,
      // 409 VERSION_CONFLICT → resolve prompt; reloading resets the form to the server copy.
      conflict: { entity: 'this account', onReload: onDone },
    },
  );
  const remove = useApiMutation((api) => api.accounts.remove(a.id), {
    invalidate: [qk.accountsAll, qk.netWorthAll],
    onSuccess: () => router.back(),
  });
  const accessibility = useWatch({ control, name: 'accessibility' });
  const isAsset = a.kind === 'asset';

  const confirmDelete = () => {
    const doIt = () => remove.mutate();
    if (Platform.OS === 'web') {
      doIt();
      return;
    }
    Alert.alert('Delete account?', 'It will be removed from your net worth. History is retained for audit.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doIt },
    ]);
  };

  return (
    <Stack gap={12}>
      <TextField control={control} name="name" label="Name" />
      <TextField control={control} name="ownership_pct" label="Ownership (%)" keyboardType="decimal-pad" />
      {isAsset ? (
        <>
          <ChoiceField
            control={control}
            name="accessibility"
            label="Accessibility"
            options={ACCESSIBILITIES.map((x) => ({ value: x, label: ACCESSIBILITY_LABELS[x] }))}
          />
          {accessibility !== defaultAccessibility(a.type) ? (
            <TextField control={control} name="accessibility_override_note" label="Override note *" multiline />
          ) : null}
          <SwitchField control={control} name="goal_eligible" label="Can fund goals" />
        </>
      ) : null}
      <SwitchField control={control} name="include_in_net_worth" label="Include in net worth" />
      <FormError error={update.error ?? remove.error} />
      <MutationButton
        label="Save changes"
        loading={update.isPending}
        testID="save-account-settings"
        onPress={handleSubmit((f) =>
          update.mutate({
            name: f.name,
            ownership_pct: f.ownership_pct,
            include_in_net_worth: f.include_in_net_worth,
            ...(isAsset
              ? {
                  accessibility: f.accessibility,
                  goal_eligible: f.goal_eligible,
                  accessibility_override_note: f.accessibility === defaultAccessibility(a.type) ? null : f.accessibility_override_note.trim(),
                }
              : {}),
            version: a.version,
          }),
        )}
      />
      <MutationButton
        label={a.archived ? 'Unarchive' : 'Archive'}
        variant="secondary"
        icon="archive-outline"
        onPress={() => update.mutate({ archived: !a.archived, version: a.version })}
      />
      <MutationButton label="Delete account" variant="danger" icon="trash-outline" onPress={confirmDelete} loading={remove.isPending} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  valRow: { gap: 6, paddingVertical: 6 },
});
