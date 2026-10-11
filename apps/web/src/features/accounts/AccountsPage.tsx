'use client';

import type { Account, Country } from '@wealthpilot/contracts';
import { ACCESSIBILITY_LABELS, COUNTRY_LABELS, templateFor, typeLabel } from '@wealthpilot/shared';
import { Archive, ArrowLeftRight, Calendar, Plus, Search, TrendingUp, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ChipGroup, SwitchRow } from '@/components/form';
import { EmptyState, LinkRow, PageHeader, QueryView } from '@/components/app';
import { ProvenancePill } from '@/components/finance/finance';
import { Money } from '@/components/finance/Money';
import { CatalogIcon } from '@/components/icons';
import { Pill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAccounts, useGrants } from '@/lib/hooks';
import { cn } from '@/lib/utils';

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

type CountryFilter = 'all' | Country;
type KindFilter = 'all' | 'asset' | 'liability';
type StatusFilter = 'all' | 'attention';

function isOwnershipFull(pct: string) {
  return /^100(\.0+)?$/.test(pct);
}

/** S07 Accounts: grouped by country and class, with stale/unverified styling and filters. */
export function AccountsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [country, setCountry] = useState<CountryFilter>('all');
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const accounts = useAccounts(showArchived);
  const grants = useGrants();

  return (
    <div data-testid="accounts-screen" className="flex flex-col gap-6">
      <PageHeader
        title="Accounts"
        description="Manual balances in their native currency. Dashed rows are estimated or stale — update them from a statement to verify."
        actions={
          <Button asChild data-testid="add-account">
            <Link href="/accounts/new">
              <Plus aria-hidden /> Add account
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardContent className="gap-3 py-4">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search accounts"
                  aria-label="Search accounts"
                  className="pl-9"
                  data-testid="account-search"
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <ChipGroup<CountryFilter>
                  ariaLabel="Filter by country"
                  value={country}
                  onChange={setCountry}
                  testIdPrefix="filter-country"
                  options={[
                    { value: 'all', label: 'All countries' },
                    { value: 'US', label: 'US' },
                    { value: 'IN', label: 'India' },
                    { value: 'OTHER', label: 'Other' },
                  ]}
                />
                <ChipGroup<KindFilter>
                  ariaLabel="Filter by class"
                  value={kind}
                  onChange={setKind}
                  testIdPrefix="filter-kind"
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'asset', label: 'Assets' },
                    { value: 'liability', label: 'Liabilities' },
                  ]}
                />
                <ChipGroup<StatusFilter>
                  ariaLabel="Filter by data status"
                  value={status}
                  onChange={setStatus}
                  testIdPrefix="filter-status"
                  options={[
                    { value: 'all', label: 'Any status' },
                    { value: 'attention', label: 'Needs update' },
                  ]}
                />
              </div>
              <SwitchRow label="Show archived accounts" checked={showArchived} onCheckedChange={setShowArchived} testId="show-archived" />
            </CardContent>
          </Card>
          <QueryView query={accounts} loadingLabel="Loading accounts">
            {(data) => {
              if (data.items.length === 0) {
                return (
                  <EmptyState
                    icon={Wallet}
                    title="No accounts yet"
                    body="Add bank, brokerage, retirement, Indian EPF/PPF/FD and debts. Mark each balance as estimated or verified."
                    action={
                      <Button asChild>
                        <Link href="/accounts/new">
                          <Plus aria-hidden /> Add account
                        </Link>
                      </Button>
                    }
                  />
                );
              }
              const needle = q.trim().toLowerCase();
              const filtered = data.items.filter(
                (a) =>
                  (country === 'all' || a.country === country) &&
                  (kind === 'all' || a.kind === kind) &&
                  (status === 'all' || a.stale || a.latest_valuation?.verification_status !== 'verified') &&
                  (!needle || a.name.toLowerCase().includes(needle) || typeLabel(a.type).toLowerCase().includes(needle)),
              );
              const groups = groupAccounts(filtered);
              if (groups.length === 0) {
                return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No accounts match these filters.</p>;
              }
              return (
                <div className="flex flex-col gap-5">
                  {groups.map((g) => (
                    <AccountGroup key={`${g.country}-${g.kind}`} title={`${COUNTRY_LABELS[g.country]} · ${g.kind === 'asset' ? 'Assets' : 'Liabilities'}`} items={g.items} />
                  ))}
                </div>
              );
            }}
          </QueryView>
        </div>
        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Equity compensation</CardTitle>
            </CardHeader>
            <CardContent className="gap-1">
              <LinkRow
                href="/rsu"
                icon={TrendingUp}
                title="RSU grants"
                subtitle={grants.data ? `${grants.data.items.length} grant(s) · vested and unvested kept separate` : 'Vests, withholding and sales'}
              />
              <LinkRow href="/rsu/calendar" icon={Calendar} title="Vest calendar" />
              <LinkRow href="/fx" icon={ArrowLeftRight} title="FX assumptions" subtitle="Your USD/INR rate" />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function AccountGroup({ title, items }: { title: string; items: Account[] }) {
  const router = useRouter();
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <table className="w-full text-sm">
          <thead className="sr-only sm:not-sr-only sm:bg-muted/60">
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-medium">Account</th>
              <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Status</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => {
              const v = a.latest_valuation;
              const unconfirmed = a.stale || v?.verification_status === 'estimated' || !v;
              return (
                <tr
                  key={a.id}
                  data-testid={`account-row-${a.id}`}
                  onClick={() => router.push(`/accounts/${a.id}`)}
                  className={cn('cursor-pointer border-t first:border-t-0 hover:bg-muted/50', unconfirmed && 'bg-warning-soft/30')}>
                  <td className={cn('px-4 py-3', unconfirmed && 'border-l-[3px] border-dashed border-l-estimated')}>
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-link">
                        <CatalogIcon name={templateFor(a.type)?.icon} className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <Link href={`/accounts/${a.id}`} className="font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={(e) => e.stopPropagation()}>
                          {a.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {typeLabel(a.type)} · {ACCESSIBILITY_LABELS[a.accessibility]}
                          {!isOwnershipFull(a.ownership_pct) ? ` · ${a.ownership_pct}% owned` : ''}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1 md:hidden">
                          <ProvenancePill verification={v?.verification_status} stale={a.stale} asOf={v?.as_of} />
                          {a.archived ? <Pill icon={<Archive aria-hidden />}>Archived</Pill> : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      <ProvenancePill verification={v?.verification_status} stale={a.stale} asOf={v?.as_of} />
                      {a.archived ? <Pill icon={<Archive aria-hidden />}>Archived</Pill> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right align-middle">
                    <Money
                      value={v?.amount ?? null}
                      currency={a.currency}
                      className={cn('font-semibold', a.kind === 'liability' && 'text-danger')}
                      qualifier={[a.kind === 'liability' ? 'owed' : null, v?.verification_status === 'estimated' ? 'estimated' : null, a.stale ? 'stale' : null].filter(Boolean).join(', ') || undefined}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
