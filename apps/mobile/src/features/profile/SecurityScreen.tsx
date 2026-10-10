import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { FormError, MutationButton, QueryView } from '@/components/app';
import { PlainTextInput, SwitchRow } from '@/components/form';
import { Card, Divider, EmptyState, Screen, SectionHeader, Stack, Text } from '@/components/primitives';
import { humanizeCode } from '@/components/finance';
import { useApi } from '@/lib/api';
import { biometricAvailability, useBiometricSetting } from '@/lib/biometric';
import { formatDate, formatTimestamp } from '@/lib/dates';
import { useApiMutation } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { useSignOutEverywhere } from '@/lib/session';

/** S22 Privacy and security: biometric lock, sign-in/security activity, account deletion. */
export default function SecurityScreen() {
  const api = useApi();
  const { enabled, setEnabled } = useBiometricSetting();
  const [availability, setAvailability] = useState<{ available: boolean; reason?: string } | null>(null);
  const [confirm, setConfirm] = useState('');
  const [scheduled, setScheduled] = useState<string | null>(null);
  const signOutEverywhere = useSignOutEverywhere();
  const events = useQuery({ queryKey: qk.securityEvents, queryFn: ({ signal }) => api.me.securityEvents({ limit: 20 }, { signal }) });

  useEffect(() => {
    void biometricAvailability().then(setAvailability);
  }, []);

  const del = useApiMutation((a) => a.privacy.requestDeletion({ confirm: 'DELETE' }), {
    onSuccess: async (res) => {
      setScheduled(res.erase_after);
      // Server revokes sessions and disables notifications; clear the device too. Push token is already
      // invalid server-side, so skip the unregister call.
      await signOutEverywhere({ skipPush: true });
    },
  });

  return (
    <Screen testID="security-screen">
      <Text variant="title">Privacy & security</Text>

      <Card>
        <Text variant="heading">App lock</Text>
        <SwitchRow
          testID="biometric-toggle"
          label="Require Face ID / fingerprint"
          helper={
            availability && !availability.available
              ? availability.reason
              : 'Locks WealthPilot whenever it goes to the background. Your device passcode works as a fallback.'
          }
          value={!!enabled}
          disabled={enabled === null || !availability?.available}
          onValueChange={(v) => void setEnabled(v)}
        />
      </Card>

      <Card>
        <Text variant="heading">Your data</Text>
        <Text variant="caption">
          Balances and plans are encrypted in transit and at rest. WealthPilot never sells identifiable financial data,
          and analytics never include amounts or personal details. Cached data on this device is removed when you sign out.
        </Text>
      </Card>

      <SectionHeader title="Recent security activity" />
      <QueryView query={events} loadingLabel="Loading activity">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState icon="shield-outline" title="No recent activity" />
          ) : (
            <Card testID="security-events">
              {data.items.map((e, i) => (
                <Stack key={e.id} gap={2}>
                  {i > 0 ? <Divider /> : null}
                  <Text variant="bodyStrong">{humanizeCode(e.action.replace(/\./g, '_'))}</Text>
                  <Text variant="caption" tone="muted">
                    {formatTimestamp(e.created_at)}
                    {e.entity_type ? ` · ${e.entity_type}` : ''}
                  </Text>
                </Stack>
              ))}
            </Card>
          )
        }
      </QueryView>

      <Card tone="danger" testID="delete-account">
        <Text variant="heading">Delete account</Text>
        <Text variant="caption">
          This signs you out everywhere, turns off notifications and schedules permanent erasure of your data. Export
          anything you want to keep first.
        </Text>
        {scheduled ? (
          <Text tone="danger" accessibilityRole="alert">
            Deletion scheduled. Data will be erased after {formatDate(scheduled)}.
          </Text>
        ) : (
          <>
            <PlainTextInput
              label='Type "DELETE" to confirm'
              value={confirm}
              onChangeText={setConfirm}
              autoCapitalize="characters"
              testID="delete-confirm"
            />
            <MutationButton
              variant="danger"
              label="Delete my account"
              icon="trash-outline"
              disabled={confirm !== 'DELETE'}
              loading={del.isPending}
              onPress={() => del.mutate()}
              testID="delete-submit"
            />
            <FormError error={del.error} />
          </>
        )}
      </Card>
    </Screen>
  );
}
