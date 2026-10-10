import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';

import { ACCESSIBILITIES, COUNTRIES, CURRENCIES, type AccountKind, type AccountType } from '@wealthpilot/contracts';

import { FormError, MutationButton } from '@/components/app';
import { ChoiceField, DateField, MoneyField, SwitchField, TextField } from '@/components/form';
import { Pill } from '@/components/finance';
import { Money } from '@/components/Money';
import { Button, Card, Chip, Icon, Row, Screen, Stack, Text } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import {
  ACCESSIBILITY_HELP,
  ACCESSIBILITY_LABELS,
  ACCOUNT_TEMPLATES,
  COUNTRY_LABELS,
  defaultAccessibility,
  templateFor,
} from '@/lib/catalog';
import { useApiMutation } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { useTheme } from '@/theme/ThemeProvider';

import {
  addAccountFormSchema,
  buildAccountCreate,
  defaultAddAccountValues,
  suggested401kTotal,
  type AddAccountForm,
} from './accountForm';
import { DetailFieldsEditor } from './DetailFieldsEditor';

/** S05 Add asset/account — guided templates per type (incl. liabilities). */
export default function AddAccountScreen() {
  const [type, setType] = useState<AccountType | null>(null);
  const [kind, setKind] = useState<AccountKind>('asset');
  if (!type) return <TemplatePicker kind={kind} onKind={setKind} onPick={setType} />;
  return <AccountForm key={type} type={type} onBack={() => setType(null)} />;
}

function TemplatePicker({
  kind,
  onKind,
  onPick,
}: {
  kind: AccountKind;
  onKind: (k: AccountKind) => void;
  onPick: (t: AccountType) => void;
}) {
  const t = useTheme();
  return (
    <Screen testID="add-account-picker">
      <Text variant="title">What would you like to add?</Text>
      <Row gap={8}>
        <Chip label="Asset" selected={kind === 'asset'} onPress={() => onKind('asset')} testID="kind-asset" />
        <Chip label="Liability (debt)" selected={kind === 'liability'} onPress={() => onKind('liability')} testID="kind-liability" />
      </Row>
      <Card tone="info">
        <Text variant="caption">
          RSU grants are tracked separately so vested and unvested shares are never mixed.{' '}
        </Text>
        <Button compact variant="ghost" label="Add an RSU grant instead" icon="trending-up-outline" onPress={() => router.replace('/rsu/new')} />
      </Card>
      <View style={styles.grid}>
        {ACCOUNT_TEMPLATES.filter((tpl) => tpl.kind === kind).map((tpl) => (
          <Pressable
            key={tpl.type}
            testID={`template-${tpl.type}`}
            onPress={() => onPick(tpl.type)}
            accessibilityRole="button"
            accessibilityLabel={`${tpl.label}. ${tpl.description}`}
            style={({ pressed }) => [
              styles.tile,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
              pressed && styles.pressed,
            ]}>
            <Icon name={tpl.icon} size={24} color={t.colors.primary} />
            <Text variant="bodyStrong">{tpl.label}</Text>
            <Text variant="caption" tone="muted">
              {tpl.description}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

function AccountForm({ type, onBack }: { type: AccountType; onBack: () => void }) {
  const tpl = templateFor(type)!;
  const { control, handleSubmit, setValue } = useForm<AddAccountForm>({
    resolver: zodResolver(addAccountFormSchema),
    defaultValues: defaultAddAccountValues(type),
  });
  const accessibility = useWatch({ control, name: 'accessibility' });
  const currency = useWatch({ control, name: 'currency' });
  const details = useWatch({ control, name: 'details' });
  const verification = useWatch({ control, name: 'verification_status' });
  const isAsset = tpl.kind === 'asset';
  const overridden = isAsset && accessibility !== defaultAccessibility(type);
  const suggestion = type === 'retirement_401k' ? suggested401kTotal(details ?? {}) : null;

  const create = useApiMutation((api, body: ReturnType<typeof buildAccountCreate>) => api.accounts.create(body), {
    invalidate: [qk.accountsAll, qk.netWorthAll, ['insights'], qk.goals],
    onSuccess: (account) => {
      analytics.track('account_created', { account_type: account.type, country: account.country });
      router.replace(`/accounts/${account.id}`);
    },
  });

  const onSubmit = handleSubmit((v) => create.mutate(buildAccountCreate(v)));

  return (
    <Screen testID="add-account-form">
      <Row>
        <Icon name={tpl.icon} size={28} />
        <View style={styles.flex}>
          <Text variant="title">{tpl.label}</Text>
          <Text tone="muted">{tpl.description}</Text>
        </View>
        <Button compact variant="ghost" label="Change type" onPress={onBack} />
      </Row>
      {tpl.tip ? (
        <Card tone="info">
          <Text variant="caption">{tpl.tip}</Text>
        </Card>
      ) : null}

      <TextField control={control} name="name" label="Name" helper="Use a nickname — no account numbers needed." />
      <ChoiceField
        control={control}
        name="country"
        label="Country"
        options={COUNTRIES.map((c) => ({ value: c, label: COUNTRY_LABELS[c] }))}
      />
      <ChoiceField
        control={control}
        name="currency"
        label="Currency (native)"
        options={CURRENCIES.map((c) => ({ value: c, label: c === 'USD' ? '$ USD' : '₹ INR' }))}
      />
      <TextField control={control} name="ownership_pct" label="Your ownership (%)" keyboardType="decimal-pad" helper="Use less than 100 for joint ownership." />

      {isAsset ? (
        <Card>
          <Text variant="heading">Accessibility</Text>
          <ChoiceField
            control={control}
            name="accessibility"
            label="How accessible is this money?"
            options={ACCESSIBILITIES.map((a) => ({
              value: a,
              label: `${ACCESSIBILITY_LABELS[a]}${a === defaultAccessibility(type) ? ' (default)' : ''}`,
            }))}
            helper={ACCESSIBILITY_HELP[accessibility]}
          />
          {overridden ? (
            <TextField
              control={control}
              name="accessibility_override_note"
              label="Why are you overriding the default? *"
              helper="Saved as an audit note on the account."
              multiline
            />
          ) : null}
          <SwitchField
            control={control}
            name="goal_eligible"
            label="Can fund goals"
            helper="Default is on only for liquid assets. Retirement funds and unvested equity are excluded by default."
          />
        </Card>
      ) : null}
      <SwitchField control={control} name="include_in_net_worth" label="Include in net worth" />

      <Card>
        <Text variant="heading">Details</Text>
        <DetailFieldsEditor control={control} type={type} currency={currency} />
        {type === 'epf' ? (
          <Card tone="warning">
            <Text variant="caption">
              ⚠ EPF withdrawal and taxability are not determined from account age. Mark access as verified only after
              checking with a qualified professional.
            </Text>
          </Card>
        ) : null}
      </Card>

      <Card>
        <Text variant="heading">{tpl.kind === 'liability' ? 'Amount owed' : 'Current balance'}</Text>
        <MoneyField
          control={control}
          name="amount"
          label={tpl.kind === 'liability' ? 'Amount owed (positive number)' : 'Balance'}
          currency={currency}
          helper="Optional now; you can add it later. Stored exactly as entered."
        />
        {suggestion ? (
          <Row gap={6} wrap>
            <Text variant="caption" tone="muted">
              Pre-tax + Roth =
            </Text>
            <Money value={suggestion} currency={currency} variant="caption" compact={false} />
            <Button compact variant="ghost" label="Use as balance" onPress={() => setValue('amount', suggestion)} />
          </Row>
        ) : null}
        <DateField control={control} name="as_of" label="Balance as of" />
        <ChoiceField
          control={control}
          name="verification_status"
          label="How sure are you?"
          options={[
            { value: 'estimated', label: 'Estimated' },
            { value: 'verified', label: 'Verified from a statement' },
          ]}
        />
        {verification === 'estimated' ? (
          <Pill icon="help-circle-outline" text="Shown as estimated until you verify it" kind="warn" />
        ) : (
          <Pill icon="checkmark-circle" text="Verified" kind="ok" />
        )}
        <TextField control={control} name="valuation_note" label="Note (optional)" multiline />
      </Card>

      <FormError error={create.error} />
      <Stack gap={8}>
        <MutationButton label="Save account" icon="checkmark" onPress={onSubmit} loading={create.isPending} testID="save-account" />
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '47%', minHeight: 110, padding: 12, borderRadius: 12, borderWidth: 1, gap: 4 },
  pressed: { opacity: 0.7 },
});
