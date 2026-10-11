'use client';

import { addMonths, dec, formatDate, formatMoney, todayIso } from '@wealthpilot/shared';
import { Calendar, GitCommitVertical, Table2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ChipGroup } from '@/components/form';
import { EmptyState, PageHeader, QueryView } from '@/components/app';
import { DataTable } from '@/components/charts';
import { VestTimeline, WarningPanel } from '@/components/finance/finance';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useVestCalendar } from '@/lib/hooks';

const RANGES = ['3', '6', '12', '24'] as const;
type Range = (typeof RANGES)[number];

/** S10 Vest calendar. Estimated values appear only where you have entered a price. */
export function VestCalendarPage() {
  const [months, setMonths] = useState<Range>('6');
  const [table, setTable] = useState(false);
  const from = todayIso();
  const to = addMonths(from, Number(months));
  const cal = useVestCalendar(from, to);
  return (
    <div data-testid="vest-calendar" className="flex flex-col gap-5">
      <PageHeader
        title="Vest calendar"
        back={{ href: '/rsu', label: 'RSU grants' }}
        description={`${formatDate(from)} – ${formatDate(to)}. Estimated gross values use your latest saved price; they are illustrative, before withholding and taxes.`}
        actions={<ChipGroup<Range> ariaLabel="Time range" value={months} onChange={setMonths} options={RANGES.map((r) => ({ value: r, label: `${r} months` }))} testIdPrefix="range" />}
      />
      <QueryView query={cal}>
        {(data) => (
          <>
            <WarningPanel warnings={data.warnings} />
            {data.items.length === 0 ? (
              <EmptyState
                icon={Calendar}
                title="No vests in this range"
                action={
                  <Button asChild variant="outline">
                    <Link href="/rsu">Manage grants</Link>
                  </Button>
                }
              />
            ) : (
              <Card>
                <CardHeader className="justify-between">
                  <CardTitle>{data.items.length} vest event(s)</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setTable((x) => !x)} aria-pressed={table}>
                    {table ? <GitCommitVertical aria-hidden /> : <Table2 aria-hidden />}
                    {table ? 'Show timeline' : 'Show table'}
                  </Button>
                </CardHeader>
                <CardContent>
                  {table ? (
                    <DataTable
                      caption="Vest calendar"
                      columns={['Date', 'Grant', 'Shares', 'Status', 'Est. gross value']}
                      rows={data.items.map((v) => [
                        formatDate(v.vest_date),
                        `${v.employer_name} (${v.symbol})`,
                        dec(v.shares).toFixed(),
                        v.status,
                        v.estimated_gross_value ? formatMoney(v.estimated_gross_value, v.currency) : 'No price',
                      ])}
                    />
                  ) : (
                    <VestTimeline
                      today={from}
                      items={data.items.map((v) => ({
                        id: v.vest_id,
                        date: v.vest_date,
                        title: `${v.employer_name} · ${v.symbol}`,
                        shares: v.shares,
                        status: v.status,
                        value: v.estimated_gross_value,
                        currency: v.currency,
                        href: `/rsu/${v.grant_id}`,
                      }))}
                    />
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </QueryView>
    </div>
  );
}
