import { router } from 'expo-router';
import { useState } from 'react';

import type { ReportingCurrency } from '@wealthpilot/contracts';

import { FormError, QueryView } from '@/components/app';
import { CurrencyToggle, Pill } from '@/components/finance';
import { SwitchRow } from '@/components/form';
import { Button, Card, Divider, LinkRow, Row, Screen, SectionHeader, Stack, Text } from '@/components/primitives';
import { useAuthSession } from '@/lib/auth/AuthContext';
import { COUNTRY_LABELS } from '@/lib/catalog';
import { useApiMutation, useMe } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { useSignOutEverywhere } from '@/lib/session';
import { useUiStore } from '@/store/ui';

const PLAN_LABELS = { free: 'Free', plus: 'Plus', pro: 'Pro' } as const;

/** Profile tab: settings hub for S12 and S20–S24 plus reporting currency and display preferences. */
export default function ProfileScreen() {
  const me = useMe();
  const { mode } = useAuthSession();
  const compact = useUiStore((s) => s.compactAmounts);
  const setCompact = useUiStore((s) => s.setCompactAmounts);
  const setDisplayCurrency = useUiStore((s) => s.setDisplayCurrency);
  const signOutEverywhere = useSignOutEverywhere();
  const [signingOut, setSigningOut] = useState(false);

  const updateCurrency = useApiMutation((api, c: ReportingCurrency) => api.me.update({ reporting_currency: c }), {
    invalidate: [qk.me],
    // The profile default changed; drop any session override so the new default shows.
    onSuccess: () => setDisplayCurrency(null),
  });

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOutEverywhere();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <Screen testID="profile-screen">
      <Text variant="title">Profile</Text>
      <QueryView query={me} loadingLabel="Loading profile">
        {(m) => (
          <Stack gap={16}>
            <Card>
              <Text variant="heading">{m.display_name || m.email}</Text>
              {m.display_name ? <Text tone="muted">{m.email}</Text> : null}
              <Row wrap gap={6}>
                <Pill text={`${PLAN_LABELS[m.entitlement]} plan`} icon="ribbon-outline" />
                {m.home_country ? <Pill text={COUNTRY_LABELS[m.home_country]} icon="location-outline" /> : null}
                {mode === 'dev' ? <Pill text="Dev sign-in" icon="construct-outline" /> : null}
              </Row>
            </Card>

            <Card>
              <Text variant="heading">Display</Text>
              <Row>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Text variant="label">Default reporting currency</Text>
                  <Text variant="caption" tone="muted">
                    Saved to your profile. Balances keep their own currency; only the reporting view converts.
                  </Text>
                </Stack>
                <CurrencyToggle
                  testID="default-currency"
                  value={m.reporting_currency}
                  onChange={(c) => c !== m.reporting_currency && updateCurrency.mutate(c)}
                />
              </Row>
              <FormError error={updateCurrency.error} />
              <Divider />
              <SwitchRow
                testID="compact-amounts"
                label="Short amounts (lakh/crore, K/M)"
                helper="Shows approximate short forms such as ₹12.35 L. Full amounts remain in screen-reader labels and detail views."
                value={compact}
                onValueChange={setCompact}
              />
            </Card>

            <Card>
              <SectionHeader title="Planning data" />
              <LinkRow icon="flag-outline" title="Tax residency" subtitle="Your residency periods (your assumption)" onPress={() => router.push('/residency')} />
              <LinkRow icon="swap-horizontal-outline" title="FX assumptions" subtitle="USD/INR rate used for reporting" onPress={() => router.push('/fx')} />
              <LinkRow icon="trending-up-outline" title="RSU grants" onPress={() => router.push('/rsu')} />
              <LinkRow icon="calendar-outline" title="Vest calendar" onPress={() => router.push('/rsu/calendar')} />
            </Card>

            <Card>
              <SectionHeader title="Account" />
              <LinkRow icon="notifications-outline" title="Notifications" subtitle="Reminders and inbox" onPress={() => router.push('/notifications')} testID="link-notifications" />
              <LinkRow icon="download-outline" title="Export data" subtitle="CSV, JSON or PDF report" onPress={() => router.push('/export')} testID="link-export" />
              <LinkRow icon="shield-checkmark-outline" title="Privacy & security" subtitle="Biometric lock, sign-in activity, delete account" onPress={() => router.push('/security')} testID="link-security" />
              <LinkRow icon="ribbon-outline" title="Subscription" subtitle={`${PLAN_LABELS[m.entitlement]} plan`} onPress={() => router.push('/subscription')} testID="link-subscription" />
              <LinkRow icon="help-circle-outline" title="Help & disclosures" onPress={() => router.push('/help')} testID="link-help" />
            </Card>

            <Button
              label="Sign out"
              icon="log-out-outline"
              variant="secondary"
              loading={signingOut}
              onPress={onSignOut}
              accessibilityHint="Signs out and removes saved data from this device"
              testID="sign-out"
            />
            <Text variant="caption" tone="muted" center>
              Signing out removes cached financial data from this device.
            </Text>
          </Stack>
        )}
      </QueryView>
    </Screen>
  );
}
