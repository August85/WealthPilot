'use client';

import { TIERS, analytics, humanizeCode, type Tier } from '@wealthpilot/shared';
import { Check, CheckCircle2, Lock } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PageHeader, QueryView } from '@/components/app';
import { Pill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMe } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/** S23 Subscription: plans (spec §12), current entitlement. Purchasing on the web is "coming soon". */
export function SubscriptionPage() {
  const search = useSearchParams();
  const reason = search?.get('reason') ?? null;
  const me = useMe();
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    analytics.track('paywall_viewed', { reason: reason ? 'plan_limit' : 'browse' });
  }, [reason]);

  const choose = (tier: Tier) => setNotice(`Upgrading to ${tier.name} is coming soon. Purchases aren’t available on the web yet.`);
  const reasonText = !reason ? null : reason === 'plan_limit' || reason === 'PLAN_LIMIT' ? 'You’ve reached a limit on your current plan.' : `You’ve reached a plan limit: ${/^[A-Z_]+$/.test(reason) ? humanizeCode(reason) : reason}`;

  return (
    <div data-testid="subscription-screen" className="flex flex-col gap-5">
      <PageHeader title="Subscription" description="Proposed plans. WealthPilot never sells identifiable financial data and does not take payment for product placement." />
      {reasonText ? (
        <Card tone="warning" data-testid="limit-reason">
          <CardContent className="flex-row items-center gap-2 py-3">
            <Lock className="size-4 shrink-0 text-warning-strong dark:text-warning" aria-hidden />
            <p className="text-sm">{reasonText}</p>
          </CardContent>
        </Card>
      ) : null}
      <QueryView query={me} loadingLabel="Loading plan">
        {(m) => (
          <>
            <p className="text-sm">
              Current plan:{' '}
              <strong data-testid="current-plan">{TIERS.find((x) => x.id === m.entitlement)?.name ?? m.entitlement}</strong>
              <span className="text-muted-foreground">
                {' '}
                · limits: accounts {m.limits.accounts ?? 'unlimited'} · goals {m.limits.goals ?? 'unlimited'} · scenarios {m.limits.scenarios ?? 'unlimited'}
              </span>
            </p>
            <ul className="grid gap-4 md:grid-cols-3">
              {TIERS.map((tier) => {
                const current = tier.id === m.entitlement;
                return (
                  <li key={tier.id} data-testid={`tier-${tier.id}`} className={cn('flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-card', current && 'border-primary ring-1 ring-primary')}>
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-semibold">{tier.name}</h2>
                      {current ? (
                        <Pill kind="ok" icon={<CheckCircle2 aria-hidden />}>
                          Current
                        </Pill>
                      ) : null}
                    </div>
                    <div>
                      <p className="text-xl font-semibold tabular">{tier.price}</p>
                      {tier.id !== 'free' ? <p className="text-xs text-muted-foreground">Proposed price</p> : null}
                    </div>
                    <ul className="flex flex-1 flex-col gap-2 text-sm">
                      {tier.features.map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                          {f}
                        </li>
                      ))}
                    </ul>
                    {!current && tier.id !== 'free' ? (
                      <Button variant="outline" onClick={() => choose(tier)} data-testid={`buy-${tier.id}`}>
                        Choose {tier.name} · coming soon
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {notice ? (
              <p role="status" className="text-sm text-muted-foreground" data-testid="purchase-notice">
                {notice}
              </p>
            ) : null}
          </>
        )}
      </QueryView>
    </div>
  );
}
