import type { FxRate } from '@wealthpilot/contracts';

import { formatDate } from '../lib/dates';
import { formatNumber } from '../lib/money';
import { Pill } from './finance';
import { Row, Stack, Text } from './primitives';

/** "1 USD = 85.00 INR · Your rate · as of … · excludes fees/spread" (spec §4.2). */
export function FxProvenance({ rates, testID = 'fx-provenance' }: { rates: FxRate[] | undefined; testID?: string }) {
  if (!rates || rates.length === 0) return null;
  return (
    <Stack gap={6} style={undefined}>
      {rates.map((r) => (
        <Stack key={`${r.base}/${r.quote}/${r.kind}`} gap={4}>
          <Text variant="label" testID={testID} tabular>
            1 {r.base} = {formatNumber(r.rate, { decimals: 4, grouping: 'western' })} {r.quote}
          </Text>
          <Row wrap gap={6}>
            <Pill icon={r.kind === 'user' ? 'person-outline' : 'globe-outline'} text={r.kind === 'user' ? 'Your saved rate' : 'Reference only'} kind={r.kind === 'user' ? 'neutral' : 'warn'} />
            <Pill icon="calendar-outline" text={`As of ${formatDate(r.as_of)}`} kind={r.stale ? 'warn' : 'neutral'} />
            {r.stale ? <Pill icon="time-outline" text="Stale rate (> 7 days)" kind="warn" /> : null}
            <Pill icon="information-circle-outline" text="Excludes fees/spread" />
          </Row>
          <Text variant="caption" tone="muted">
            Source: {r.provider}
            {r.license_reference ? ` · Licence ${r.license_reference}` : ''}
          </Text>
        </Stack>
      ))}
    </Stack>
  );
}
