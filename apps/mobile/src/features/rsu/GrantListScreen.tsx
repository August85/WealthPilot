import { router } from 'expo-router';

import { QueryView } from '@/components/app';
import { Pill } from '@/components/finance';
import { Button, Card, EmptyState, LinkRow, Row, Screen, Stack, Text } from '@/components/primitives';
import { formatDate } from '@/lib/dates';
import { dec } from '@/lib/decimal';
import { useGrants } from '@/lib/hooks';

/** RSU grant library (entry to S09/S10). */
export default function GrantListScreen() {
  const grants = useGrants();
  return (
    <Screen testID="grant-list">
      <Row>
        <Text variant="title" style={{ flex: 1 }}>
          RSU grants
        </Text>
        <Button compact label="New grant" icon="add" onPress={() => router.push('/rsu/new')} />
      </Row>
      <Card tone="info">
        <Text variant="caption">
          Unvested shares never count toward current or liquid net worth. Vest-day value and withholding shown here are
          illustrative cash-flow estimates, not tax calculations.
        </Text>
      </Card>
      <QueryView query={grants}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              icon="trending-up-outline"
              title="No RSU grants yet"
              body="Add a grant and generate its vest schedule."
              actionLabel="Add grant"
              onAction={() => router.push('/rsu/new')}
            />
          ) : (
            <Card>
              {data.items.map((g) => (
                <Stack key={g.id} gap={2}>
                  <LinkRow
                    icon="trending-up-outline"
                    title={`${g.employer_name} · ${g.symbol}`}
                    subtitle={`Granted ${formatDate(g.grant_date)} · ${dec(g.granted_shares).toFixed()} shares`}
                    onPress={() => router.push(`/rsu/${g.id}`)}
                  />
                  <Row wrap gap={6}>
                    <Pill text={`Held ${dec(g.totals.held).toFixed()}`} icon="checkmark-circle" kind="ok" />
                    <Pill text={`Unvested ${dec(g.totals.unvested).toFixed()}`} icon="hourglass-outline" />
                    {g.held_in_account_id ? <Pill text="Held in brokerage account" icon="link-outline" kind="accent" /> : null}
                  </Row>
                </Stack>
              ))}
            </Card>
          )
        }
      </QueryView>
      <Button label="Vest calendar" icon="calendar-outline" variant="secondary" onPress={() => router.push('/rsu/calendar')} />
    </Screen>
  );
}
