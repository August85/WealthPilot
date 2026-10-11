'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  compareDecimal,
  isApiError,
  rsuDispositionCreateSchema,
  rsuVestUpdateSchema,
  type RsuGrant,
  type RsuVest,
} from '@wealthpilot/contracts';
import { dec, formatDate, formatRate, fractionToPercent, parseMoneyInput, percentToFraction, sumDec, todayIso } from '@wealthpilot/shared';
import { AlertTriangle, Calendar, CheckCircle2, ChevronDown, ChevronUp, Clock, Link2, Pencil, Plus, Trash2, User, XCircle } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { FormError, PageHeader, QueryView, Section } from '@/components/app';
import { ChoiceField, DateField, MoneyField, NumberField, PercentField, TextField } from '@/components/form';
import { KeyValue, KeyValueList } from '@/components/finance/finance';
import { Money } from '@/components/finance/Money';
import { Pill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog } from '@/components/ui/dialog';
import { useApi } from '@/lib/api';
import { useAccounts, useApiMutation, useGrant } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { cn } from '@/lib/utils';

const shares = (v: string | null | undefined) => (v == null ? '—' : dec(v).toFixed());
const GRANT_KEYS = [qk.rsuAll, qk.netWorthAll, qk.insightsAll];

/** S09 RSU grant editor: vests, record actual vest, sell-to-cover/sale, held-in brokerage link, employer price. */
export function GrantEditorPage() {
  const params = useParams<{ id: string }>();
  const grant = useGrant(params?.id);
  return (
    <div data-testid="grant-editor">
      <QueryView query={grant}>{(g) => <GrantEditor grant={g} />}</QueryView>
    </div>
  );
}

function GrantEditor({ grant: g }: { grant: RsuGrant }) {
  const router = useRouter();
  const accounts = useAccounts();
  const held = accounts.data?.items.find((a) => a.id === g.held_in_account_id);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useApiMutation((api) => api.rsu.deleteGrant(g.id), { invalidate: GRANT_KEYS, onSuccess: () => router.push('/rsu') });
  const vests = g.vests.slice().sort((a, b) => a.vest_date.localeCompare(b.vest_date));
  return (
    <>
      <PageHeader
        title={`${g.employer_name} · ${g.symbol}`}
        back={{ href: '/rsu', label: 'RSU grants' }}
        description={`Granted ${formatDate(g.grant_date)} · ${shares(g.granted_shares)} shares · ${g.award_currency}${g.grant_price ? ` · grant price ${g.grant_price}` : ''}`}
        actions={
          <Button variant="outline" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden /> Delete grant
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Vests" description="Record each actual vest; sales and sell-to-cover are tracked per vest.">
            {vests.length === 0 ? <p className="text-sm text-muted-foreground">No vest events yet.</p> : null}
            <div className="flex flex-col gap-3">
              {vests.map((v) => (
                <VestCard key={v.id} vest={v} grant={g} />
              ))}
            </div>
            <AddVest grantId={g.id} />
          </Section>
          <FormError error={remove.error} />
        </div>
        <div className="flex flex-col gap-5">
          <Card data-testid="grant-totals">
            <CardHeader>
              <CardTitle>Share ledger</CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValueList>
                <KeyValue label="Scheduled">{shares(g.totals.scheduled)}</KeyValue>
                <KeyValue label="Vested">{shares(g.totals.vested)}</KeyValue>
                <KeyValue label="Withheld (sell-to-cover)">{shares(g.totals.withheld)}</KeyValue>
                <KeyValue label="Sold">{shares(g.totals.sold)}</KeyValue>
                <KeyValue label="Held now">{shares(g.totals.held)}</KeyValue>
                <KeyValue label="Unvested (not in net worth)">{shares(g.totals.unvested)}</KeyValue>
              </KeyValueList>
              <p className="text-xs text-muted-foreground">
                Default withholding assumption {formatRate(g.default_withholding_rate)} — illustrative only, not your actual tax.
              </p>
            </CardContent>
          </Card>
          <Card tone="info" data-testid="held-in-note">
            <CardContent className="flex-row items-start gap-2 text-sm">
              <Link2 className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
              <p>
                {g.held_in_account_id
                  ? `Held shares sit in “${held?.name ?? 'a linked brokerage account'}”. That account’s balance is assumed to include them, so they are not added to net worth again.`
                  : 'Held shares are not linked to a tracked account, so held shares × your latest price are added as a liquid asset.'}
              </p>
            </CardContent>
          </Card>
          <PriceCard symbol={g.symbol} currency={g.award_currency} />
          <Card>
            <CardHeader className="justify-between">
              <CardTitle>Grant settings</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setEditing((e) => !e)}>
                <Pencil aria-hidden /> {editing ? 'Close' : 'Edit'}
              </Button>
            </CardHeader>
            <CardContent>
              {editing ? (
                <EditGrant grant={g} onDone={() => setEditing(false)} />
              ) : (
                <KeyValueList>
                  <KeyValue label="Employer">{g.employer_name}</KeyValue>
                  <KeyValue label="Ticker">{g.symbol}</KeyValue>
                  <KeyValue label="Held in">{held?.name ?? 'Not linked'}</KeyValue>
                  <KeyValue label="Version">{String(g.version)}</KeyValue>
                </KeyValueList>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this grant?"
        description="The grant, its vests and sales are removed from your net worth and plans."
        actions={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                setConfirmDelete(false);
                remove.mutate();
              }}>
              Delete grant
            </Button>
          </>
        }
      />
    </>
  );
}

const priceSchema = z.object({
  price: z.string().refine((v) => parseMoneyInput(v) !== null && !v.includes('-'), 'Enter a price'),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
});

function PriceCard({ symbol, currency }: { symbol: string; currency: string }) {
  const api = useApi();
  const price = useQuery({
    queryKey: qk.price(symbol),
    queryFn: ({ signal }) => api.prices.get(symbol, { signal }),
    retry: false,
  });
  const form = useForm<z.infer<typeof priceSchema>>({ resolver: zodResolver(priceSchema), defaultValues: { price: '', as_of: todayIso() } });
  const save = useApiMutation(
    (a, f: z.infer<typeof priceSchema>) => a.prices.save({ symbol, price: parseMoneyInput(f.price) ?? '0', currency, as_of: f.as_of }),
    { invalidate: [qk.price(symbol), ...GRANT_KEYS], onSuccess: () => form.reset({ price: '', as_of: todayIso() }) },
  );
  const missing = price.isError && isApiError(price.error) && price.error.status === 404;
  return (
    <Card data-testid="price-card">
      <CardHeader>
        <CardTitle>{symbol} price (your entry)</CardTitle>
      </CardHeader>
      <CardContent className="gap-4">
        {price.data ? (
          <div className="flex flex-wrap items-center gap-2">
            <Money value={price.data.price} currency={price.data.currency} className="text-xl font-semibold" />
            <Pill kind={price.data.stale ? 'warn' : 'neutral'} icon={<Calendar aria-hidden />}>
              As of {formatDate(price.data.as_of)}
            </Pill>
            {price.data.stale ? (
              <Pill kind="warn" icon={<Clock aria-hidden />}>
                Stale (&gt; 7 days)
              </Pill>
            ) : null}
            <Pill icon={<User aria-hidden />}>Manual</Pill>
          </div>
        ) : missing ? (
          <p className="flex items-start gap-2 text-sm text-warning-strong dark:text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> No price yet — vest values cannot be estimated. WealthPilot never fabricates prices.
          </p>
        ) : null}
        <form className="flex flex-col gap-3" noValidate onSubmit={form.handleSubmit((f) => save.mutate(f))}>
          <div className="grid gap-3 sm:grid-cols-2">
            <MoneyField control={form.control} name="price" label="Price per share" currency={currency} />
            <DateField control={form.control} name="as_of" label="Price date" />
          </div>
          <FormError error={save.error} />
          <Button type="submit" size="sm" variant="outline" className="w-fit" loading={save.isPending}>
            Save price
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const editGrantSchema = z.object({
  employer_name: z.string().trim().min(1, 'Employer is required'),
  symbol: z.string().trim().min(1, 'Ticker is required').max(20),
  withholding_pct: z.string().regex(/^(\d+(\.\d+)?)?$/, 'Enter a percentage'),
  held_in_account_id: z.string(),
});

function EditGrant({ grant: g, onDone }: { grant: RsuGrant; onDone: () => void }) {
  const accounts = useAccounts();
  const [baseVersion] = useState(g.version);
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
        version: baseVersion,
      }),
    { invalidate: GRANT_KEYS, onSuccess: onDone, conflict: { entity: 'this grant', onReload: onDone } },
  );
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit((f) => update.mutate(f))}>
      <TextField control={control} name="employer_name" label="Employer" />
      <TextField control={control} name="symbol" label="Ticker" />
      <PercentField control={control} name="withholding_pct" label="Default withholding (%, illustrative)" />
      <ChoiceField
        control={control}
        name="held_in_account_id"
        label="Held in brokerage account"
        variant="select"
        options={[{ value: '', label: 'Not linked' }, ...brokerages.map((a) => ({ value: a.id, label: a.name }))]}
      />
      <FormError error={update.error} />
      <Button type="submit" loading={update.isPending} className="w-fit">
        Save grant
      </Button>
    </form>
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

const VEST_META = {
  scheduled: { icon: Clock, label: 'Scheduled', cls: 'text-info' },
  vested: { icon: CheckCircle2, label: 'Vested', cls: 'text-success' },
  cancelled: { icon: XCircle, label: 'Cancelled', cls: 'text-muted-foreground' },
} as const;

function VestCard({ vest: v, grant: g }: { vest: RsuVest; grant: RsuGrant }) {
  const [open, setOpen] = useState(false);
  const meta = VEST_META[v.status];
  const Icon = meta.icon;
  const sold = sumDec(v.dispositions.filter((d) => d.kind === 'sale').map((d) => d.shares));
  const cover = sumDec(v.dispositions.filter((d) => d.kind === 'sell_to_cover').map((d) => d.shares));
  return (
    <Card data-testid={`vest-${v.id}`}>
      <CardContent className="gap-3 py-4">
        <div className="flex items-center gap-3">
          <Icon className={cn('size-5 shrink-0', meta.cls)} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{formatDate(v.vest_date)}</p>
            <p className="text-xs text-muted-foreground">
              {meta.label} · scheduled {shares(v.scheduled_shares)}
              {v.vested_shares ? ` · vested ${shares(v.vested_shares)}` : ''}
              {v.withheld_shares ? ` · withheld ${shares(v.withheld_shares)}` : ''}
            </p>
            {v.dispositions.length ? (
              <p className="text-xs text-muted-foreground">
                Sold-to-cover {cover.toFixed()} · sold {sold.toFixed()}
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid={`vest-toggle-${v.id}`}>
            {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
            {open ? 'Close' : v.status === 'scheduled' ? 'Record vest' : 'Details'}
          </Button>
        </div>
        {open ? (
          <div className="grid gap-5 border-t pt-4 md:grid-cols-2">
            <RecordVest vest={v} grant={g} />
            {v.status === 'vested' ? <Dispositions vest={v} grant={g} /> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RecordVest({ vest: v, grant: g }: { vest: RsuVest; grant: RsuGrant }) {
  const [baseVersion] = useState(v.version);
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
  const fmv = w.vest_fmv ? parseMoneyInput(w.vest_fmv) : null;
  const gross = w.vested_shares && /^\d+(\.\d+)?$/.test(w.vested_shares) && fmv ? dec(w.vested_shares).times(dec(fmv)) : null;
  const illustrativeWithholding = gross ? gross.times(dec(g.default_withholding_rate)).toFixed(2) : null;
  const update = useApiMutation(
    (api, body: z.output<typeof vestFormSchema>) => api.rsu.updateVest(v.id, { ...body, ...(baseVersion ? { version: baseVersion } : {}) }),
    { invalidate: GRANT_KEYS, conflict: { entity: 'this vest' } },
  );
  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={handleSubmit((b) => update.mutate(b))}>
      <p className="text-sm font-semibold">Record the actual vest</p>
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
      <NumberField control={control} name="vested_shares" label="Shares vested" />
      <MoneyField control={control} name="vest_fmv" label="Fair market value on vest date (per share)" currency={g.award_currency} />
      <NumberField control={control} name="withheld_shares" label="Shares withheld for taxes" />
      {gross ? (
        <div className="rounded-lg border border-info/30 bg-info-soft p-3 text-xs">
          <p className="flex flex-wrap gap-1">
            Gross vest value <Money value={gross.toFixed(2)} currency={g.award_currency} compact={false} className="font-semibold" />
          </p>
          <p className="flex flex-wrap gap-1">
            Illustrative withholding at {formatRate(g.default_withholding_rate)}{' '}
            <Money value={illustrativeWithholding} currency={g.award_currency} compact={false} className="font-semibold" />
          </p>
          <p className="mt-1 text-muted-foreground">For cash-flow illustration only. Actual payroll withholding, income tax and capital gains are separate.</p>
        </div>
      ) : null}
      <FormError error={update.error} />
      <Button type="submit" size="sm" className="w-fit" loading={update.isPending} data-testid={`save-vest-${v.id}`}>
        Save vest
      </Button>
    </form>
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
    invalidate: GRANT_KEYS,
    onSuccess: () => reset(),
  });
  const used = sumDec([v.withheld_shares, ...v.dispositions.map((d) => d.shares)]);
  const available = dec(v.vested_shares).minus(used);
  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={handleSubmit((b) => {
        // Share conservation (sold + withheld ≤ vested) is enforced by the API; check early for a clear message.
        if (compareDecimal(b.shares, available.toFixed()) > 0) {
          setError('shares', { message: `Only ${available.toFixed()} shares remain after withholding and earlier sales` });
          return;
        }
        add.mutate(b);
      })}>
      <p className="text-sm font-semibold">Sales and sell-to-cover</p>
      {v.dispositions.length ? (
        <ul className="flex flex-col gap-1 text-xs">
          {v.dispositions.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-1.5">
              <Pill>{d.kind === 'sale' ? 'Sale' : 'Sell-to-cover'}</Pill>
              <span className="tabular">
                {formatDate(d.date)} · {shares(d.shares)} sh @
              </span>
              <Money value={d.price} currency={g.award_currency} compact={false} />
              {d.fees && !/^0+(\.0+)?$/.test(d.fees) ? <span className="text-muted-foreground">fees {d.fees}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">Shares still available to sell from this vest: {available.toFixed()}</p>
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
      <NumberField control={control} name="shares" label="Shares" />
      <MoneyField control={control} name="price" label="Price per share" currency={g.award_currency} />
      <MoneyField control={control} name="fees" label="Fees (optional)" currency={g.award_currency} />
      <FormError error={add.error} />
      <Button type="submit" size="sm" variant="outline" className="w-fit" loading={add.isPending}>
        Add sale
      </Button>
    </form>
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
    { invalidate: GRANT_KEYS, onSuccess: () => reset() },
  );
  const duplicate = isApiError(add.error) && add.error.code === 'DUPLICATE_VEST';
  if (!open) {
    return (
      <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Add a vest event
      </Button>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add vest event</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-3" noValidate onSubmit={handleSubmit((f) => add.mutate(f))}>
          <DateField control={control} name="vest_date" label="Vest date" />
          <NumberField control={control} name="scheduled_shares" label="Scheduled shares" />
          <TextField control={control} name="source_event_id" label="Source event ID (optional)" />
          <div className="flex flex-col gap-2 sm:col-span-3">
            {duplicate ? (
              <p role="alert" className="flex items-center gap-1.5 text-sm text-warning-strong dark:text-warning">
                <AlertTriangle className="size-4" aria-hidden /> This vest already exists for that date and source ID — duplicate imports are blocked.
              </p>
            ) : (
              <FormError error={add.error} />
            )}
            <div className="flex gap-2">
              <Button type="submit" loading={add.isPending}>
                Add vest
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
