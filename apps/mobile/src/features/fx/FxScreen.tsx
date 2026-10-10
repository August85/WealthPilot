import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { isApiError, positiveDecimal } from '@wealthpilot/contracts';

import { FormError, MutationButton } from '@/components/app';
import { DateField, TextField } from '@/components/form';
import { FxProvenance } from '@/components/FxProvenance';
import { Button, Card, Icon, LoadingState, Row, Screen, Stack, Text } from '@/components/primitives';
import { useApi } from '@/lib/api';
import { formatDate, todayIso } from '@/lib/dates';
import { useApiMutation, useFxRate } from '@/lib/hooks';
import { formatNumber } from '@/lib/money';
import { qk } from '@/lib/query';
import { useTheme } from '@/theme/ThemeProvider';

const fxFormSchema = z.object({
  rate: positiveDecimal,
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
});
type FxForm = z.infer<typeof fxFormSchema>;

/**
 * S12 FX assumptions. Your saved USD/INR rate is the only rate used in calculations. The ECB-based reference
 * rate is a suggestion only and is never used unless you save it as your rate (DECISIONS.md, FX).
 */
export default function FxScreen() {
  const t = useTheme();
  const api = useApi();
  const userRate = useFxRate('USD', 'INR');
  const reference = useQuery({
    queryKey: qk.fxReference('USD', 'INR'),
    queryFn: ({ signal }) => api.fx.getReference({ base: 'USD', quote: 'INR' }, { signal }),
    retry: false,
    staleTime: 60 * 60 * 1000,
  });
  const { control, handleSubmit, setValue } = useForm<FxForm>({
    resolver: zodResolver(fxFormSchema),
    defaultValues: { rate: '', as_of: todayIso() },
  });
  const save = useApiMutation(
    (a, f: FxForm) => a.fx.saveRate({ base: 'USD', quote: 'INR', rate: f.rate, as_of: f.as_of }),
    { invalidate: [['fx'], qk.netWorthAll, ['insights'], ['scenario-defaults']] },
  );
  const missing = userRate.isError && isApiError(userRate.error) && userRate.error.code === 'FX_RATE_MISSING';

  return (
    <Screen testID="fx-screen">
      <Text variant="title">FX assumptions</Text>
      <Text tone="muted">
        WealthPilot converts INR and USD with the rate you choose. It never silently uses a market feed.
      </Text>

      <Card testID="user-rate">
        <Text variant="heading">Your planning rate</Text>
        {userRate.isLoading ? <LoadingState /> : null}
        {userRate.data ? (
          <>
            <FxProvenance rates={[userRate.data]} />
            {userRate.data.stale ? (
              <Card tone="warning">
                <Text>⏱ Your rate is more than 7 days old. Consider saving an updated rate.</Text>
              </Card>
            ) : null}
          </>
        ) : null}
        {missing ? (
          <Card tone="danger">
            <Text>
              ⚠ No USD/INR rate saved. Accounts in the other currency are excluded from totals until you save one (never
              silently converted).
            </Text>
          </Card>
        ) : null}
      </Card>

      <Card testID="reference-rate" tone="info">
        <Row gap={8}>
          <Icon name="globe-outline" color={t.colors.info} />
          <Text variant="heading" style={{ flex: 1 }}>
            Reference rate
          </Text>
        </Row>
        <Text variant="bodyStrong" tone="warning">
          Reference only, not used unless you save it.
        </Text>
        {reference.data ? (
          <Stack gap={6}>
            <Text tabular>
              1 USD = {formatNumber(reference.data.rate, { decimals: 4 })} INR · {formatDate(reference.data.as_of)}
            </Text>
            <Text variant="caption" tone="muted">
              {reference.data.provider}. Free ECB-based reference data, not a licensed or tradable rate; excludes fees and
              spread{reference.data.stale ? '. This cached value is stale — the feed may be down.' : '.'}
            </Text>
            <Button
              compact
              variant="secondary"
              label="Use this as my rate"
              icon="arrow-down"
              onPress={() => {
                setValue('rate', reference.data.rate);
                setValue('as_of', reference.data.as_of);
              }}
              accessibilityHint="Copies the reference rate into the form below. It is not used until you save."
            />
          </Stack>
        ) : reference.isError ? (
          <Text tone="muted">Reference feed unavailable right now. Enter your own rate.</Text>
        ) : (
          <LoadingState />
        )}
      </Card>

      <Card>
        <Text variant="heading">Save a new rate</Text>
        <TextField control={control} name="rate" label="INR per 1 USD" keyboardType="decimal-pad" placeholder="e.g. 85.00" />
        <DateField control={control} name="as_of" label="Rate date" />
        <Text variant="caption" tone="muted">
          Saved rates are kept with their date, so past reports stay reproducible.
        </Text>
        <FormError error={save.error} />
        {save.isSuccess ? <Text tone="success">✓ Saved. Totals now use this rate.</Text> : null}
        <MutationButton label="Save my rate" icon="checkmark" onPress={handleSubmit((f) => save.mutate(f))} loading={save.isPending} testID="save-fx" />
      </Card>
    </Screen>
  );
}
