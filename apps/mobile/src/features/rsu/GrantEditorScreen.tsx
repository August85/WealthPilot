import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import {
  compareDecimal,
  isApiError,
  rsuDispositionCreateSchema,
  rsuVestUpdateSchema,
  type RsuGrant,
  type RsuVest,
} from '@wealthpilot/contracts';

import { FormError, MutationButton, QueryView } from '@/components/app';
import { ChoiceField, DateField, MoneyField, PercentField, TextField } from '@/components/form';
import { KeyValue, Pill } from '@/components/finance';
import { Money } from '@/components/Money';
import { Button, Card, Divider, Icon, Row, Screen, SectionHeader, Stack, Text } from '@/components/primitives';
import { formatDate, todayIso } from '@/lib/dates';
import { dec, formatRate, fractionToPercent, percentToFraction, sumDec } from '@/lib/decimal';
import { useApi } from '@/lib/api';
import { useAccounts, useApiMutation, useGrant } from '@/lib/hooks';
import { parseMoneyInput } from '@/lib/money';
import { qk } from '@/lib/query';
import { useTheme } from '@/theme/ThemeProvider';

const shares = (v: string | null | undefined) => (v == null ? '—' : dec(v).toFixed());

/** S09 RSU grant editor: vests, record actual vest, sell-to-cover/sale, held-in brokerage link, employer price. */
export default function GrantEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const grant = useGrant(id);
  return (
    <Screen testID="grant-editor">
      <QueryView query={grant}>{(g) => <GrantEditor grant={g} />}</QueryView>
    </Screen>
  );
}

function GrantEditor({ grant: g }: { grant: RsuGrant }) {
  const accounts = useAccounts();
  const held = accounts.data?.items.find((a) => a.id === g.held_in_account_id);
  const [editing, setEditing] = useState(false);
  const invalidate = [qk.grant(g.id), qk.grants, ['rsu'], qk.netWorthAll, ['insights']];
  const remove = useApiMutation((api) => api.rsu.deleteGrant(g.id), { invalidate, onSuccess: () => router.back() });
  return (
    <Stack gap={16}>
      <View>
        <Text variant="title">
          {g.employer_name} · {g.symbol}
        </Text>
        <Text tone="muted">
          Granted {formatDate(g.grant_date)} · {shares(g.granted_shares)} shares · {g.award_currency}
          {g.grant_price ? ` · grant price ${g.grant_price}` : ''}
        </Text>
      </View>
      <Card testID="grant-totals">
        <Text variant="heading">Share ledger</Text>
        <KeyValue label="Scheduled">{shares(g.totals.scheduled)}</KeyValue>
        <KeyValue label="Vested">{shares(g.totals.vested)}</KeyValue>
        <KeyValue label="Withheld (sell-to-cover)">{shares(g.totals.withheld)}</KeyValue>
        <KeyValue label="Sold">{shares(g.totals.sold)}</KeyValue>
        <KeyValue label="Held now">{shares(g.totals.held)}</KeyValue>
        <KeyValue label="Unvested (not in net worth)">{shares(g.totals.unvested)}</KeyValue>
        <Text variant="caption" tone="muted">
          Default withholding assumption {formatRate(g.default_withholding_rate)} — illustrative only, not your actual tax.
        </Text>
      </Card>
      <Card tone="info" testID="held-in-note">
        <Row gap={8}>
          <Icon name="link-outline" />
          <Text style={{ flex: 1 }}>
            {g.held_in_account_id
              ? `Held shares sit in “${held?.name ?? 'a linked brokerage account'}”. That account’s balance is assumed to include them, so they are not added to net worth again.`
              : 'Held shares are not linked to a tracked account, so held shares × your latest price are added as a liquid asset.'}
          </Text>
        </Row>
      </Card>
      <PriceCard symbol={g.symbol} currency={g.award_currency} />
      <Card>
        <SectionHeader
          title="Grant settings"
          action={<Button compact variant="ghost" label={editing ? 'Close' : 'Edit'} onPress={() => setEditing((e) => !e)} />}
        />
        {editing ? <EditGrant grant={g} onDone={() => setEditing(false)} /> : null}
      </Card>
      <SectionHeader title="Vests" />
      {g.vests.length === 0 ? <Text tone="muted">No vest events yet.</Text> : null}
      {g.vests
        .slice()
        .sort((a, b) => a.vest_date.localeCompare(b.vest_date))
        .map((v) => (
          <VestCard key={v.id} vest={v} grant={g} />
        ))}
      <AddVest grantId={g.id} />
      <FormError error={remove.error} />
      <MutationButton label="Delete grant" variant="danger" icon="trash-outline" onPress={() => remove.mutate()} />
    </Stack>
  );
}

function PriceCard({ symbol, currency }: { symbol: string; currency: string }) {
  const api = useApi();
  const price = useQuery({
    queryKey: qk.price(symbol),
    queryFn: ({ signal }) => api.prices.get(symbol, { signal }),
    retry: false,
  });
  const form = useForm<{ price: string; as_of: string }>({
    resolver: zodResolver(
      z.object({
        price: z.string().refine((v) => parseMoneyInput(v) !== null && !v.includes('-'), 'Enter a price'),
        as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
      }),
    ),
    defaultValues: { price: '', as_of: todayIso() },
  });
  const save = useApiMutation(
    (a, f: { price: string; as_of: string }) => a.prices.save({ symbol, price: parseMoneyInput(f.price)!, currency, as_of: f.as_of }),
    { invalidate: [qk.price(symbol), ['rsu'], qk.netWorthAll], onSuccess: () => form.reset({ price: '', as_of: todayIso() }) },
  );
  const missing = price.isError && isApiError(price.error) && price.error.status === 404;
  return (
    <Card testID="price-card">
      <Text variant="heading">{symbol} price (your entry)</Text>
      {price.data ? (
        <Row gap={8} wrap>
          <Money value={price.data.price} currency={price.data.currency} variant="bodyStrong" />
          <Pill icon="calendar-outline" text={`As of ${formatDate(price.data.as_of)}`} kind={price.data.stale ? 'warn' : 'neutral'} />
          {price.data.stale ? <Pill icon="time-outline" text="Stale (> 7 days)" kind="warn" /> : null}
          <Pill icon="person-outline" text="Manual" />
        </Row>
      ) : missing ? (
        <Text tone="warning">⚠ No price yet — vest values cannot be estimated. WealthPilot never fabricates prices.</Text>
      ) : null}
      <MoneyField control={form.control} name="price" label="Price per share" currency={currency} />
      <DateField control={form.control} name="as_of" label="Price date" />
      <FormError error={save.error} />
      <MutationButton label="Save price" compact onPress={form.handleSubmit((f) => save.mutate(f))} loading={save.isPending} />
    </Card>
  );
}

const editGrantSchema = z.object({
  employer_name: z.string().trim().min(1),
  symbol: z.string().trim().min(1).max(20),
  withholding_pct: z.string().regex(/^(\d+(\.\d+)?)?$/, 'Enter a percentage'),
  held_in_account_id: z.string(),
});

function EditGrant({ grant: g, onDone }: { grant: RsuGrant; onDone: () => void }) {
  const accounts = useAccounts();
  const brokerages = (accounts.data?.items ?? []).filter((a) => a.type === 'brokerage');
  const { control, handleSubmit } = useForm<z.infer<typeof editGrantSchema>>({
    resolver: zodResolver(editGrantSchema),
    defaultValues: {
      employer_name: g.employer_name,
      symbol: g.symbol,
      withholding_pct: fractionToPercent(g.default_withholding_rate),
      held_in_account_id: g.held_in_account_id ?? '',
    },
  });
  const update = useApiMutation(
    (api, f: z.infer<typeof editGrantSchema>) =>
      api.rsu.updateGrant(g.id, {
        employer_name: f.employer_name,
        symbol: f.symbol.toUpperCase(),
        held_in_account_id: f.held_in_account_id || null,
        ...(f.withholding_pct ? { default_withholding_rate: percentToFraction(f.withholding_pct) } : {}),
        version: g.version,
      }),
    {
      invalidate: [qk.grant(g.id), qk.grants, qk.netWorthAll],
      onSuccess: onDone,
      conflict: { entity: 'this grant', onReload: onDone },
    },
  );
  return (
    <Stack gap={12}>
      <TextField control={control} name="employer_name" label="Employer" />
      <TextField control={control} name="symbol" label="Ticker" autoCapitalize="characters" />
      <PercentField control={control} name="withholding_pct" label="Default withholding (%, illustrative)" />
      <ChoiceField
        control={control}
        name="held_in_account_id"
        label="Held in brokerage account"
        options={[{ value: '', label: 'Not linked' }, ...brokerages.map((a) => ({ value: a.id, label: a.name }))]}
      />
      <FormError error={update.error} />
      <MutationButton label="Save grant" onPress={handleSubmit((f) => update.mutate(f))} loading={update.isPending} />
    </Stack>
  );
}

const vestFormSchema = z
  .object({
    status: z.enum(['scheduled', 'vested', 'cancelled']),
    vested_shares: z.string(),
    vest_fmv: z.string(),
    withheld_shares: z.string(),
  })
  .transform((f) => ({
    status: f.status,
    vested_shares: f.vested_shares.trim() || null,
    vest_fmv: f.vest_fmv.trim() ? parseMoneyInput(f.vest_fmv) : null,
    withheld_shares: f.withheld_shares.trim() || null,
  }))
  .pipe(rsuVestUpdateSchema);

function VestCard({ vest: v, grant: g }: { vest: RsuVest; grant: RsuGrant }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const meta = {
    scheduled: { icon: 'time-outline' as const, label: 'Scheduled' },
    vested: { icon: 'checkmark-circle' as const, label: 'Vested' },
    cancelled: { icon: 'close-circle-outline' as const, label: 'Cancelled' },
  }[v.status];
  const sold = sumDec(v.dispositions.filter((d) => d.kind === 'sale').map((d) => d.shares));
  const cover = sumDec(v.dispositions.filter((d) => d.kind === 'sell_to_cover').map((d) => d.shares));
  return (
    <Card testID={`vest-${v.id}`}>
      <Row gap={8}>
        <Icon name={meta.icon} color={v.status === 'vested' ? t.colors.success : t.colors.textMuted} />
        <View style={styles.flex}>
          <Text variant="bodyStrong">{formatDate(v.vest_date)}</Text>
          <Text variant="caption" tone="muted">
            {meta.label} · scheduled {shares(v.scheduled_shares)}
            {v.vested_shares ? ` · vested ${shares(v.vested_shares)}` : ''}
            {v.withheld_shares ? ` · withheld ${shares(v.withheld_shares)}` : ''}
          </Text>
          {v.dispositions.length ? (
            <Text variant="caption" tone="muted">
              Sold-to-cover {cover.toFixed()} · sold {sold.toFixed()}
            </Text>
          ) : null}
        </View>
        <Button compact variant="ghost" label={open ? 'Close' : v.status === 'scheduled' ? 'Record vest' : 'Details'} onPress={() => setOpen((o) => !o)} />
      </Row>
      {open ? (
        <Stack gap={12}>
          <Divider />
          <RecordVest vest={v} grant={g} />
          {v.status === 'vested' ? <Dispositions vest={v} grant={g} /> : null}
        </Stack>
      ) : null}
    </Card>
  );
}

function RecordVest({ vest: v, grant: g }: { vest: RsuVest; grant: RsuGrant }) {
  const { control, handleSubmit } = useForm<z.input<typeof vestFormSchema>, unknown, z.output<typeof vestFormSchema>>({
    resolver: zodResolver(vestFormSchema),
    defaultValues: {
      status: v.status === 'scheduled' ? 'vested' : v.status,
      vested_shares: v.vested_shares ?? v.scheduled_shares,
      vest_fmv: v.vest_fmv ?? '',
      withheld_shares: v.withheld_shares ?? '',
    },
  });
  const w = useWatch({ control });
  const gross = w.vested_shares && w.vest_fmv && parseMoneyInput(w.vest_fmv) ? dec(w.vested_shares).times(dec(parseMoneyInput(w.vest_fmv))) : null;
  const illustrativeWithholding = gross ? gross.times(dec(g.default_withholding_rate)).toFixed(2) : null;
  const update = useApiMutation(
    (api, body: z.output<typeof vestFormSchema>) => api.rsu.updateVest(v.id, { ...body, ...(v.version ? { version: v.version } : {}) }),
    { invalidate: [qk.grant(g.id), qk.grants, ['rsu'], qk.netWorthAll, ['insights']], conflict: { entity: 'this vest' } },
  );
  return (
    <Stack gap={10}>
      <Text variant="label">Record the actual vest</Text>
      <ChoiceField
        control={control}
        name="status"
        label="Status"
        options={[
          { value: 'scheduled', label: 'Scheduled' },
          { value: 'vested', label: 'Vested' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
      />
      <TextField control={control} name="vested_shares" label="Shares vested" keyboardType="decimal-pad" />
      <MoneyField control={control} name="vest_fmv" label="Fair market value on vest date (per share)" currency={g.award_currency} />
      <TextField control={control} name="withheld_shares" label="Shares withheld for taxes" keyboardType="decimal-pad" />
      {gross ? (
        <Card tone="info">
          <Row gap={6} wrap>
            <Text variant="caption">Gross vest value</Text>
            <Money value={gross.toFixed(2)} currency={g.award_currency} variant="caption" compact={false} />
          </Row>
          <Row gap={6} wrap>
            <Text variant="caption">Illustrative withholding at {formatRate(g.default_withholding_rate)}</Text>
            <Money value={illustrativeWithholding} currency={g.award_currency} variant="caption" compact={false} />
          </Row>
          <Text variant="caption" tone="muted">
            For cash-flow illustration only. Actual payroll withholding, income tax and capital gains are separate.
          </Text>
        </Card>
      ) : null}
      <FormError error={update.error} />
      <MutationButton label="Save vest" onPress={handleSubmit((b) => update.mutate(b))} loading={update.isPending} testID={`save-vest-${v.id}`} />
    </Stack>
  );
}

const dispFormSchema = z
  .object({ date: z.string(), kind: z.enum(['sell_to_cover', 'sale']), shares: z.string(), price: z.string(), fees: z.string() })
  .transform((f) => ({
    date: f.date,
    kind: f.kind,
    shares: f.shares.trim(),
    price: parseMoneyInput(f.price) ?? f.price,
    ...(f.fees.trim() ? { fees: parseMoneyInput(f.fees) ?? f.fees } : {}),
  }))
  .pipe(rsuDispositionCreateSchema);

function Dispositions({ vest: v, grant: g }: { vest: RsuVest; grant: RsuGrant }) {
  const { control, handleSubmit, reset, setError } = useForm<z.input<typeof dispFormSchema>, unknown, z.output<typeof dispFormSchema>>({
    resolver: zodResolver(dispFormSchema),
    defaultValues: { date: v.vest_date, kind: 'sale', shares: '', price: '', fees: '' },
  });
  const add = useApiMutation((api, body: z.output<typeof dispFormSchema>) => api.rsu.addDisposition(v.id, body), {
    invalidate: [qk.grant(g.id), qk.grants, ['rsu'], qk.netWorthAll],
    onSuccess: () => reset(),
  });
  const used = sumDec([v.withheld_shares, ...v.dispositions.map((d) => d.shares)]);
  const available = dec(v.vested_shares).minus(used);
  return (
    <Stack gap={10}>
      <Text variant="label">Sales and sell-to-cover</Text>
      {v.dispositions.map((d) => (
        <Row key={d.id} gap={6} wrap>
          <Pill text={d.kind === 'sale' ? 'Sale' : 'Sell-to-cover'} />
          <Text variant="caption" tabular>
            {formatDate(d.date)} · {shares(d.shares)} sh @
          </Text>
          <Money value={d.price} currency={g.award_currency} variant="caption" compact={false} />
          {d.fees && d.fees !== '0' ? (
            <Text variant="caption" tone="muted">
              fees {d.fees}
            </Text>
          ) : null}
        </Row>
      ))}
      <Text variant="caption" tone="muted">
        Shares still available to sell from this vest: {available.toFixed()}
      </Text>
      <DateField control={control} name="date" label="Date" />
      <ChoiceField
        control={control}
        name="kind"
        label="Type"
        options={[
          { value: 'sale', label: 'Sale' },
          { value: 'sell_to_cover', label: 'Sell-to-cover' },
        ]}
      />
      <TextField control={control} name="shares" label="Shares" keyboardType="decimal-pad" />
      <MoneyField control={control} name="price" label="Price per share" currency={g.award_currency} />
      <MoneyField control={control} name="fees" label="Fees (optional)" currency={g.award_currency} />
      <FormError error={add.error} />
      <MutationButton
        label="Add sale"
        onPress={handleSubmit((b) => {
          // Share conservation (sold + withheld ≤ vested) is enforced by the API; check early for a clear message.
          if (compareDecimal(b.shares, available.toFixed()) > 0) {
            setError('shares', { message: `Only ${available.toFixed()} shares remain after withholding and earlier sales` });
            return;
          }
          add.mutate(b);
        })}
        loading={add.isPending}
      />
    </Stack>
  );
}

const addVestSchema = z.object({
  vest_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  scheduled_shares: z.string().regex(/^\d+(\.\d+)?$/, 'Enter shares'),
  source_event_id: z.string(),
});

function AddVest({ grantId }: { grantId: string }) {
  const [open, setOpen] = useState(false);
  const { control, handleSubmit, reset } = useForm<z.infer<typeof addVestSchema>>({
    resolver: zodResolver(addVestSchema),
    defaultValues: { vest_date: todayIso(), scheduled_shares: '', source_event_id: '' },
  });
  const add = useApiMutation(
    (api, f: z.infer<typeof addVestSchema>) =>
      api.rsu.addVest(grantId, {
        vest_date: f.vest_date,
        scheduled_shares: f.scheduled_shares,
        ...(f.source_event_id.trim() ? { source_event_id: f.source_event_id.trim() } : {}),
      }),
    { invalidate: [qk.grant(grantId), qk.grants, ['rsu']], onSuccess: () => reset() },
  );
  const duplicate = isApiError(add.error) && add.error.code === 'DUPLICATE_VEST';
  if (!open) return <Button label="Add a vest event" icon="add" variant="secondary" onPress={() => setOpen(true)} />;
  return (
    <Card>
      <Text variant="heading">Add vest event</Text>
      <DateField control={control} name="vest_date" label="Vest date" />
      <TextField control={control} name="scheduled_shares" label="Scheduled shares" keyboardType="decimal-pad" />
      <TextField control={control} name="source_event_id" label="Source event ID (optional, from your broker)" autoCapitalize="none" />
      {duplicate ? (
        <Text tone="warning" accessibilityRole="alert">
          ⚠ This vest already exists for that date and source ID — duplicate imports are blocked.
        </Text>
      ) : (
        <FormError error={add.error} />
      )}
      <MutationButton label="Add vest" onPress={handleSubmit((f) => add.mutate(f))} loading={add.isPending} />
    </Card>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
