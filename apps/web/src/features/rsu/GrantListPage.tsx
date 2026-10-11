'use client';

import { dec, formatDate } from '@wealthpilot/shared';
import { Calendar, CheckCircle2, Hourglass, Info, Link2, Plus, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { EmptyState, PageHeader, QueryView } from '@/components/app';
import { Pill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useGrants } from '@/lib/hooks';

/** RSU grant library (entry to S09/S10). */
export function GrantListPage() {
  const grants = useGrants();
  return (
    <div data-testid="grant-list" className="flex flex-col gap-5">
      <PageHeader
        title="RSU grants"
        description="Vested and unvested shares are tracked separately. Unvested shares never count toward current or liquid net worth."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/rsu/calendar">
                <Calendar aria-hidden /> Vest calendar
              </Link>
            </Button>
            <Button asChild>
              <Link href="/rsu/new">
                <Plus aria-hidden /> New grant
              </Link>
            </Button>
          </>
        }
      />
      <Card tone="info">
        <CardContent className="flex-row items-start gap-2 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          Vest-day value and withholding shown here are illustrative cash-flow estimates, not tax calculations.
        </CardContent>
      </Card>
      <QueryView query={grants}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title="No RSU grants yet"
              body="Add a grant and generate its vest schedule."
              action={
                <Button asChild>
                  <Link href="/rsu/new">
                    <Plus aria-hidden /> Add grant
                  </Link>
                </Button>
              }
            />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.items.map((g) => (
                <li key={g.id}>
                  <Link
                    href={`/rsu/${g.id}`}
                    data-testid={`grant-${g.id}`}
                    className="flex h-full flex-col gap-3 rounded-xl border bg-card p-5 shadow-card transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-ring">
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-link">
                        <TrendingUp className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {g.employer_name} · {g.symbol}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Granted {formatDate(g.grant_date)} · {dec(g.granted_shares).toFixed()} shares
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Pill kind="ok" icon={<CheckCircle2 aria-hidden />}>
                        Held {dec(g.totals.held).toFixed()}
                      </Pill>
                      <Pill icon={<Hourglass aria-hidden />}>Unvested {dec(g.totals.unvested).toFixed()}</Pill>
                      {g.held_in_account_id ? (
                        <Pill kind="accent" icon={<Link2 aria-hidden />}>
                          Held in brokerage account
                        </Pill>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
    </div>
  );
}
