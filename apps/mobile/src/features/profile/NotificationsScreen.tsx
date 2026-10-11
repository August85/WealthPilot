import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import type { NotificationPreference } from '@wealthpilot/contracts';
import { NOTIFICATION_TYPE_LABELS as TYPE_LABELS, normalizePreferences } from '@wealthpilot/shared';

import { FormError, MutationButton, QueryView } from '@/components/app';
import { SwitchRow } from '@/components/form';
import { Card, EmptyState, Icon, Row, Screen, SectionHeader, Stack, Text } from '@/components/primitives';
import { useApi } from '@/lib/api';
import { formatTimestamp } from '@/lib/dates';
import { useApiMutation } from '@/lib/hooks';
import { hasRegisteredPush, registerForPush, unregisterPush } from '@/lib/push';
import { qk } from '@/lib/query';
import { useTheme } from '@/theme/ThemeProvider';

export { normalizePreferences };

/** S20 Notifications: opt-in push preferences, device registration and the in-app inbox. */
export default function NotificationsScreen() {
  const api = useApi();
  const t = useTheme();
  const prefs = useQuery({ queryKey: qk.notificationPrefs, queryFn: ({ signal }) => api.notifications.getPreferences({ signal }) });
  const inbox = useQuery({ queryKey: qk.inbox, queryFn: ({ signal }) => api.notifications.inbox(undefined, { signal }) });
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  useEffect(() => {
    void hasRegisteredPush().then(setPushOn);
  }, []);

  const savePrefs = useApiMutation(
    (a, items: NotificationPreference[]) => a.notifications.updatePreferences({ items }),
    { invalidate: [qk.notificationPrefs] },
  );
  const markRead = useApiMutation((a, id: string) => a.notifications.markRead(id), { invalidate: [qk.inbox] });
  const togglePush = useApiMutation(async (a, on: boolean) => {
    if (on) {
      const r = await registerForPush(a);
      setPushMessage(r.ok ? 'This device will receive reminders you turn on below.' : r.reason);
      setPushOn(r.ok);
    } else {
      await unregisterPush(a);
      setPushOn(false);
      setPushMessage('This device will no longer receive push reminders.');
    }
  });

  return (
    <Screen testID="notifications-screen">
      <Text variant="title">Notifications</Text>
      <Text tone="muted">Everything is off until you turn it on. Notifications never include balances or amounts.</Text>

      <Card>
        <Text variant="heading">This device</Text>
        {Platform.OS === 'web' ? (
          <Text tone="muted">Push notifications are available in the iOS and Android apps. Your inbox below works everywhere.</Text>
        ) : (
          <>
            <Row>
              <Icon name={pushOn ? 'notifications' : 'notifications-off-outline'} color={pushOn ? t.colors.success : t.colors.textMuted} />
              <Text style={{ flex: 1 }}>{pushOn ? 'Push is on for this device' : 'Push is off for this device'}</Text>
            </Row>
            <MutationButton
              compact
              variant="secondary"
              label={pushOn ? 'Turn off push on this device' : 'Turn on push on this device'}
              loading={togglePush.isPending}
              onPress={() => togglePush.mutate(!pushOn)}
              testID="push-toggle"
            />
          </>
        )}
        {pushMessage ? (
          <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
            {pushMessage}
          </Text>
        ) : null}
        <FormError error={togglePush.error} />
      </Card>

      <QueryView query={prefs} loadingLabel="Loading preferences">
        {(data) => {
          const items = normalizePreferences(data.items);
          return (
            <Card testID="notification-prefs">
              <Text variant="heading">Reminders</Text>
              {items.map((p) => (
                <SwitchRow
                  key={p.type}
                  testID={`pref-${p.type}`}
                  label={TYPE_LABELS[p.type].title}
                  helper={TYPE_LABELS[p.type].helper}
                  value={p.enabled}
                  disabled={savePrefs.isPending}
                  onValueChange={(enabled) =>
                    savePrefs.mutate(items.map((x) => (x.type === p.type ? { ...x, enabled } : x)))
                  }
                />
              ))}
              <FormError error={savePrefs.error} />
            </Card>
          );
        }}
      </QueryView>

      <SectionHeader title="Inbox" />
      <QueryView query={inbox} loadingLabel="Loading inbox">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState icon="mail-open-outline" title="No notifications yet" />
          ) : (
            <Stack gap={8}>
              {data.items.map((n) => (
                <Card key={n.id} testID={`inbox-${n.id}`} accessibilityLabel={`${n.read_at ? '' : 'Unread. '}${n.title}. ${n.body}`}>
                  <Row>
                    <Icon name={n.read_at ? 'mail-open-outline' : 'mail-unread-outline'} color={n.read_at ? t.colors.textMuted : t.colors.primary} />
                    <Text variant={n.read_at ? 'body' : 'bodyStrong'} style={{ flex: 1 }}>
                      {n.title}
                    </Text>
                    {!n.read_at ? (
                      <Text variant="caption" tone="primary">
                        Unread
                      </Text>
                    ) : null}
                  </Row>
                  <Text>{n.body}</Text>
                  <Text variant="caption" tone="muted">
                    {formatTimestamp(n.created_at)}
                  </Text>
                  {!n.read_at ? (
                    <MutationButton compact variant="ghost" label="Mark as read" onPress={() => markRead.mutate(n.id)} />
                  ) : null}
                </Card>
              ))}
            </Stack>
          )
        }
      </QueryView>
    </Screen>
  );
}
