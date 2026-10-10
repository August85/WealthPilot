import { router } from 'expo-router';
import { useState } from 'react';

import { QueryView } from '@/components/app';
import { DataTable } from '@/components/charts';
import { VestTimeline, WarningPanel } from '@/components/finance';
import { Button, Card, Chip, EmptyState, Row, Screen, Text } from '@/components/primitives';
import { addMonths, formatDate, todayIso } from '@/lib/dates';
import { dec } from '@/lib/decimal';
import { useVestCalendar } from '@/lib/hooks';
import { formatMoney } from '@/lib/money';

const RANGES = [3, 6, 12, 24] as const;

/** S10 Vest calendar. Estimated values appear only where you have entered a price. */
export default function VestCalendarScreen() {
  const [months, setMonths] = useState<(typeof RANGES)[number]>(6);
  const [table, setTable] = useState(false);
  const from = todayIso();
  const to = addMonths(from, months);
  const cal = useVestCalendar(from, to);
  return (
    <Screen testID="vest-calendar">
      <Text variant="title">Vest calendar</Text>
      <Row wrap gap={8} accessibilityRole="radiogroup" accessibilityLabel="Time range">
        {RANGES.map((r) => (
          <Chip key={r} label={`${r} months`} selected={months === r} onPress={() => setMonths(r)} />
        ))}
      </Row>
      <Text variant="caption" tone="muted">
        {formatDate(from)} – {formatDate(to)}. Estimated gross values use your latest saved price; they are illustrative,
        before withholding and taxes.
      </Text>
      <QueryView query={cal}>
        {(data) => (
          <>
            <WarningPanel warnings={data.warnings} />
            {data.items.length === 0 ? (
              <EmptyState
                icon="calendar-outline"
                title="No vests in this range"
                actionLabel="Manage grants"
                onAction={() => router.push('/rsu')}
              />
            ) : (
              <Card>
                <Row>
                  <Text variant="heading" style={{ flex: 1 }}>
                    {data.items.length} vest event(s)
                  </Text>
                  <Button
                    compact
                    variant="ghost"
                    label={table ? 'Show timeline' : 'Show table'}
                    icon={table ? 'git-commit-outline' : 'list-outline'}
                    onPress={() => setTable((x) => !x)}
                  />
                </Row>
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
                    }))}
                    onPressItem={(vestId) => {
                      const item = data.items.find((x) => x.vest_id === vestId);
                      if (item) router.push(`/rsu/${item.grant_id}`);
                    }}
                  />
                )}
              </Card>
            )}
          </>
        )}
      </QueryView>
    </Screen>
  );
}
