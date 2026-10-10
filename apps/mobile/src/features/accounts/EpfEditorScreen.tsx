import { router, useLocalSearchParams } from 'expo-router';
import { useForm, useWatch } from 'react-hook-form';

import type { Account } from '@wealthpilot/contracts';

import { FormError, MutationButton, QueryView } from '@/components/app';
import { BalanceCard, Pill } from '@/components/finance';
import { Money } from '@/components/Money';
import { Card, Icon, Row, Screen, Stack, Text } from '@/components/primitives';
import { sumDec } from '@/lib/decimal';
import { useAccount, useApiMutation } from '@/lib/hooks';
import { parseMoneyInput } from '@/lib/money';
import { qk } from '@/lib/query';
import { useTheme } from '@/theme/ThemeProvider';

import { DetailFieldsEditor } from './DetailFieldsEditor';
import { detailsToPayload, payloadToDetails, validateDetails, type DetailFormValues } from './detailFields';

/** S11 EPF editor: components, contributions, rate, access status (manual, never inferred). */
export default function EpfEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const account = useAccount(id);
  return (
    <Screen testID="epf-editor">
      <QueryView query={account}>{(a) => <EpfForm key={`${a.id}-${a.version}`} account={a} />}</QueryView>
    </Screen>
  );
}

function EpfForm({ account: a }: { account: Account }) {
  const t = useTheme();
  const { control, handleSubmit, setError } = useForm<{ details: DetailFormValues }>({
    defaultValues: { details: payloadToDetails('epf', a.details as Record<string, unknown>) },
  });
  const details = useWatch({ control, name: 'details' });
  const access = details?.access_status;
  const componentsTotal = sumDec([
    parseMoneyInput(String(details?.employee_component ?? '')) ?? '0',
    parseMoneyInput(String(details?.employer_component ?? '')) ?? '0',
  ]).toFixed(2);

  const save = useApiMutation(
    (api, d: DetailFormValues) => api.accounts.update(a.id, { details: detailsToPayload('epf', d), version: a.version }),
    {
      invalidate: [qk.account(a.id), qk.accountsAll, qk.netWorthAll, ['insights']],
      onSuccess: () => router.back(),
      conflict: { entity: 'this EPF account' },
    },
  );

  const onSubmit = handleSubmit((v) => {
    const errs = validateDetails('epf', v.details);
    const keys = Object.keys(errs);
    if (keys.length) {
      for (const k of keys) setError(`details.${k}`, { message: errs[k] });
      return;
    }
    save.mutate(v.details);
  });

  return (
    <Stack gap={16}>
      <Text variant="title">{a.name}</Text>
      <BalanceCard
        title="Latest recorded balance"
        amount={a.latest_valuation?.amount ?? null}
        currency={a.currency}
        verification={a.latest_valuation?.verification_status}
        stale={a.stale}
        asOf={a.latest_valuation?.as_of}
        variant="heading"
      />
      <Card tone="warning" testID="epf-warning">
        <Row gap={8}>
          <Icon name="warning" color={t.colors.warning} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            Professional verification needed
          </Text>
        </Row>
        <Text>
          EPF withdrawal eligibility and taxability depend on your employment, residency and the rules in force. WealthPilot
          never asserts them from account age. Planning treats EPF as restricted unless you mark access as verified.
        </Text>
        {access === 'user_verified_accessible' ? (
          <Pill icon="person-outline" text="You marked access as verified (your responsibility)" kind="warn" />
        ) : (
          <Pill icon="lock-closed-outline" text="Treated as not accessible" />
        )}
      </Card>
      <Card>
        <Text variant="heading">Components and contributions</Text>
        <DetailFieldsEditor control={control} type="epf" currency={a.currency} />
        <Row gap={6} wrap>
          <Text variant="caption" tone="muted">
            Employee + employer components:
          </Text>
          <Money value={componentsTotal} currency={a.currency} variant="caption" compact={false} />
        </Row>
        <Text variant="caption" tone="muted">
          To change the balance itself, add a valuation on the account screen (history is append-only).
        </Text>
      </Card>
      <FormError error={save.error} />
      <MutationButton label="Save EPF details" icon="checkmark" onPress={onSubmit} loading={save.isPending} testID="save-epf" />
    </Stack>
  );
}
