'use client';

import { useQuery } from '@tanstack/react-query';
import type { NotificationPreference } from '@wealthpilot/contracts';
import { NOTIFICATION_TYPE_LABELS, formatTimestamp, normalizePreferences } from '@wealthpilot/shared';
import { Mail, MailOpen, Smartphone } from 'lucide-react';

import { SwitchRow } from '@/components/form';
import { EmptyState, FormError, PageHeader, QueryView } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/lib/api';
import { useApiMutation, useInbox } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { cn } from '@/lib/utils';

/** S20 Notifications: in-app inbox (live) and opt-in reminder preferences. */
export function NotificationsPage() {
  const api = useApi();
  const prefs = useQuery({ queryKey: qk.notificationPrefs, queryFn: ({ signal }) => api.notifications.getPreferences({ signal }) });
  const inbox = useInbox();
  const savePrefs = useApiMutation((a, items: NotificationPreference[]) => a.notifications.updatePreferences({ items }), {
    invalidate: [qk.notificationPrefs],
  });
  const markRead = useApiMutation((a, id: string) => a.notifications.markRead(id), { invalidate: [qk.inbox] });

  return (
    <div data-testid="notifications-screen">
      <PageHeader title="Notifications" description="Everything is off until you turn it on. Notifications never include balances or amounts." />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <section aria-label="Inbox" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Inbox</h2>
          <QueryView query={inbox} loadingLabel="Loading inbox">
            {(data) =>
              data.items.length === 0 ? (
                <EmptyState icon={MailOpen} title="No notifications yet" body="Reminders you turn on appear here and on your phone." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.items.map((n) => (
                    <li key={n.id} data-testid={`inbox-${n.id}`} className={cn('flex gap-3 rounded-xl border bg-card p-4 shadow-card', !n.read_at && 'border-primary/50')}>
                      {n.read_at ? <MailOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Mail className="mt-0.5 size-4 shrink-0 text-link" aria-hidden />}
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm', !n.read_at && 'font-semibold')}>
                          {!n.read_at ? <span className="sr-only">Unread: </span> : null}
                          {n.title}
                        </p>
                        <p className="text-sm">{n.body}</p>
                        <p className="text-xs text-muted-foreground">{formatTimestamp(n.created_at)}</p>
                      </div>
                      {!n.read_at ? (
                        <Button variant="ghost" size="sm" onClick={() => markRead.mutate(n.id)} disabled={markRead.isPending}>
                          Mark as read
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryView>
        </section>
        <div className="flex flex-col gap-5">
          <QueryView query={prefs} loadingLabel="Loading preferences" rows={1}>
            {(data) => {
              const items = normalizePreferences(data.items);
              return (
                <Card data-testid="notification-prefs">
                  <CardHeader>
                    <CardTitle>Reminders</CardTitle>
                  </CardHeader>
                  <CardContent className="gap-1">
                    {items.map((p) => (
                      <SwitchRow
                        key={p.type}
                        testId={`pref-${p.type}`}
                        label={NOTIFICATION_TYPE_LABELS[p.type].title}
                        helper={NOTIFICATION_TYPE_LABELS[p.type].helper}
                        checked={p.enabled}
                        disabled={savePrefs.isPending}
                        onCheckedChange={(enabled) => savePrefs.mutate(items.map((x) => (x.type === p.type ? { ...x, enabled } : x)))}
                      />
                    ))}
                    <FormError error={savePrefs.error} />
                  </CardContent>
                </Card>
              );
            }}
          </QueryView>
          <Card tone="muted">
            <CardHeader className="flex-col">
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="size-4" aria-hidden /> Push notifications
              </CardTitle>
              <CardDescription>Push is delivered to the iOS and Android apps. Turn it on from the app on your phone; this inbox works everywhere.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  );
}
