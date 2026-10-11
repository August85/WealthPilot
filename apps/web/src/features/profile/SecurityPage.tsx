'use client';

import { useQuery } from '@tanstack/react-query';
import { formatDate, formatTimestamp, humanizeCode } from '@wealthpilot/shared';
import { Lock, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { EmptyState, FormError, PageHeader, QueryView } from '@/components/app';
import { PlainInput } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/lib/api';
import { ClerkSecurityCard } from '@/lib/auth/ClerkSecurityCard';
import { useAuthSession } from '@/lib/auth/context';
import { useApiMutation } from '@/lib/hooks';
import { qk } from '@/lib/query';

/** S22 Privacy and security: sign-in methods (Clerk), security activity, account deletion. */
export function SecurityPage() {
  const api = useApi();
  const auth = useAuthSession();
  const [confirm, setConfirm] = useState('');
  const [scheduled, setScheduled] = useState<string | null>(null);
  const events = useQuery({ queryKey: qk.securityEvents, queryFn: ({ signal }) => api.me.securityEvents({ limit: 20 }, { signal }) });

  const del = useApiMutation((a) => a.privacy.requestDeletion({ confirm: 'DELETE' }), {
    onSuccess: (res) => {
      setScheduled(res.erase_after);
      // The server revokes sessions; sign this tab out shortly after showing the confirmation.
      setTimeout(() => void auth.signOut(), 4000);
    },
  });

  return (
    <div data-testid="security-screen">
      <PageHeader title="Privacy & security" back={{ href: '/settings', label: 'Settings' }} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          {auth.mode === 'clerk' ? <ClerkSecurityCard /> : null}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="size-4" aria-hidden /> Your data
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              Balances and plans are encrypted in transit and at rest. WealthPilot never sells identifiable financial data, and analytics never include amounts or
              personal details. The web app keeps financial data in memory only — nothing is written to your browser’s storage — and clears it when you sign out.
            </CardContent>
          </Card>
          <Card tone="danger" data-testid="delete-account">
            <CardHeader className="flex-col">
              <CardTitle>Delete account</CardTitle>
              <CardDescription className="text-foreground">
                This signs you out everywhere, turns off notifications and schedules permanent erasure of your data. Export anything you want to keep first.
              </CardDescription>
            </CardHeader>
            <CardContent className="gap-3">
              {scheduled ? (
                <p role="alert" className="font-medium text-danger">
                  Deletion scheduled. Data will be erased after {formatDate(scheduled)}. Signing you out…
                </p>
              ) : (
                <>
                  <label htmlFor="delete-confirm" className="text-sm font-medium">
                    Type DELETE to confirm
                  </label>
                  <PlainInput id="delete-confirm" value={confirm} onChange={setConfirm} testId="delete-confirm" autoComplete="off" />
                  <Button variant="danger" className="w-fit" disabled={confirm !== 'DELETE'} loading={del.isPending} onClick={() => del.mutate()} data-testid="delete-submit">
                    <Trash2 aria-hidden /> Delete my account
                  </Button>
                  <FormError error={del.error} />
                </>
              )}
            </CardContent>
          </Card>
        </div>
        <section className="flex flex-col gap-3" aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="text-lg font-semibold">
            Recent security activity
          </h2>
          <QueryView query={events} loadingLabel="Loading activity">
            {(data) =>
              data.items.length === 0 ? (
                <EmptyState icon={ShieldCheck} title="No recent activity" />
              ) : (
                <Card data-testid="security-events">
                  <CardContent className="py-2">
                    <ul className="divide-y">
                      {data.items.map((e) => (
                        <li key={e.id} className="py-2.5">
                          <p className="text-sm font-medium">{humanizeCode(e.action.replace(/\./g, '_'))}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatTimestamp(e.created_at)}
                            {e.entity_type ? ` · ${e.entity_type}` : ''}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )
            }
          </QueryView>
        </section>
      </div>
    </div>
  );
}
