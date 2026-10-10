import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Account, Country } from '@wealthpilot/contracts';

import { QueryView } from '@/components/app';
import { SwitchRow } from '@/components/form';
import { Pill, ProvenancePill } from '@/components/finance';
import { Money } from '@/components/Money';
import { Button, Card, EmptyState, Icon, LinkRow, Row, Screen, SectionHeader, Stack, Text } from '@/components/primitives';
import { ACCESSIBILITY_LABELS, COUNTRY_LABELS, templateFor, typeLabel } from '@/lib/catalog';
import { useAccounts, useGrants } from '@/lib/hooks';
import { useTheme } from '@/theme/ThemeProvider';

const COUNTRY_ORDER: Country[] = ['US', 'IN', 'OTHER'];

export function groupAccounts(accounts: Account[]) {
  const groups: { country: Country; kind: 'asset' | 'liability'; items: Account[] }[] = [];
  for (const country of COUNTRY_ORDER) {
    for (const kind of ['asset', 'liability'] as const) {
      const items = accounts
        .filter((a) => a.country === country && a.kind === kind)
        .sort((a, b) => typeLabel(a.type).localeCompare(typeLabel(b.type)) || a.name.localeCompare(b.name));
      if (items.length) groups.push({ country, kind, items });
    }
  }
  return groups;
}

/** S07 Account list grouped by country and class; stale/unverified styling. */
export default function AccountListScreen() {
  const [showArchived, setShowArchived] = useState(false);
  const accounts = useAccounts(showArchived);
  const grants = useGrants();
  return (
    <Screen testID="accounts-screen">
      <Row>
        <Text variant="title" style={styles.flex}>
          Accounts
        </Text>
        <Button compact label="Add" icon="add" onPress={() => router.push('/accounts/new')} testID="add-account" />
      </Row>
      <QueryView query={accounts} loadingLabel="Loading accounts">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              icon="wallet-outline"
              title="No accounts yet"
              body="Add bank, brokerage, retirement, Indian EPF/PPF/FD and debts. Mark each balance as estimated or verified."
              actionLabel="Add account"
              onAction={() => router.push('/accounts/new')}
            />
          ) : (
            <Stack gap={16}>
              {groupAccounts(data.items).map((g) => (
                <View key={`${g.country}-${g.kind}`}>
                  <SectionHeader title={`${COUNTRY_LABELS[g.country]} · ${g.kind === 'asset' ? 'Assets' : 'Liabilities'}`} />
                  <Card>
                    {g.items.map((a) => (
                      <AccountRow key={a.id} account={a} />
                    ))}
                  </Card>
                </View>
              ))}
            </Stack>
          )
        }
      </QueryView>
      <Card>
        <SectionHeader title="Equity compensation" />
        <LinkRow
          icon="trending-up-outline"
          title="RSU grants"
          subtitle={grants.data ? `${grants.data.items.length} grant(s) · vested and unvested kept separate` : 'Vests, withholding and sales'}
          onPress={() => router.push('/rsu')}
        />
        <LinkRow icon="calendar-outline" title="Vest calendar" onPress={() => router.push('/rsu/calendar')} />
        <LinkRow icon="swap-horizontal" title="FX assumptions" subtitle="Your USD/INR rate" onPress={() => router.push('/fx')} />
      </Card>
      <SwitchRow label="Show archived accounts" value={showArchived} onValueChange={setShowArchived} />
    </Screen>
  );
}

function AccountRow({ account: a }: { account: Account }) {
  const t = useTheme();
  const v = a.latest_valuation;
  const unconfirmed = a.stale || v?.verification_status === 'estimated';
  const icon = templateFor(a.type)?.icon ?? 'cube-outline';
  return (
    <Pressable
      testID={`account-row-${a.id}`}
      onPress={() => router.push(`/accounts/${a.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${a.name}, ${typeLabel(a.type)}${a.stale ? ', stale' : ''}${v?.verification_status === 'estimated' ? ', estimated' : ''}${a.archived ? ', archived' : ''}`}
      style={({ pressed }) => [
        styles.row,
        unconfirmed && [styles.unconfirmed, { borderLeftColor: t.colors.estimated }],
        pressed && styles.pressed,
      ]}>
      <Icon name={icon} color={t.colors.primary} />
      <View style={styles.flex}>
        <Text variant="bodyStrong">{a.name}</Text>
        <Text variant="caption" tone="muted">
          {typeLabel(a.type)} · {ACCESSIBILITY_LABELS[a.accessibility]}
          {a.ownership_pct !== '100' && a.ownership_pct !== '100.00' ? ` · ${a.ownership_pct}% owned` : ''}
        </Text>
        <ProvenancePill verification={v?.verification_status} stale={a.stale} asOf={v?.as_of} />
        {a.archived ? <Pill icon="archive-outline" text="Archived" /> : null}
      </View>
      <Money
        value={v?.amount ?? null}
        currency={a.currency}
        variant="bodyStrong"
        tone={a.kind === 'liability' ? 'danger' : 'default'}
        qualifier={a.kind === 'liability' ? 'owed' : undefined}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10, minHeight: 56 },
  unconfirmed: { borderLeftWidth: 3, borderStyle: 'dashed', paddingLeft: 8 },
  pressed: { opacity: 0.7 },
});
