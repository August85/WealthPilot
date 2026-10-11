'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ACCESSIBILITIES, compareDecimal, type Account, type AccountUpdate, type Valuation } from '@wealthpilot/contracts';
import {
  ACCESSIBILITY_LABELS,
  COUNTRY_LABELS,
  analytics,
  defaultAccessibility,
  detailFieldsFor,
  detailsToPayload,
  formatDate,
  formatTimestamp,
  parseMoneyInput,
  payloadToDetails,
  todayIso,
  typeLabel,
  validateDetails,
} from '@wealthpilot/shared';
import { Archive, ArchiveRestore, Building2, Clock, GitCommitHorizontal, Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { FormError, PageHeader, QueryView } from '@/components/app';
import { ProjectionChart } from '@/components/charts';
import { ChoiceField, DateField, MoneyField, SwitchField, TextField } from '@/components/form';
import { BalanceCard, KeyValue, KeyValueList, ProvenancePill } from '@/components/finance/finance';
import { Money } from '@/components/finance/Money';
import { Pill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog } from '@/components/ui/dialog';
import { useAccount, useApiMutation, useValuations } from '@/lib/hooks';
import { HOUSEHOLD_KEYS, qk } from '@/lib/query';
import { cn } from '@/lib/utils';

import { DetailFieldsEditor } from './DetailFieldsEditor';

export const valuationFormSchema = z.object({
  amount: z
    .string()
    .refine((v) => !v.includes('-'), 'Amounts are never negative. Liabilities are entered as the positive amount owed.')
    .refine((v) => parseMoneyInput(v) !== null, 'Enter an amount like 10000.00'),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  verification_status: z.enum(['estimated', 'verified']),
  note: z.string().max(500),
});
type ValuationForm = z.infer<typeof valuationFormSchema>;

/** S08 Account detail: valuation history chart, append valuation, traceable corrections, settings. */
export function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  const account = useAccount(params?.id);
  return (
    <div data-testid="account-detail">
      <QueryView query={account} loadingLabel="Loading account">
        {(a) => <AccountDetail account={a} />}
      </QueryView>
    </div>
  );
}

function AccountDetail({ account: a }: { account: Account }) {
  const valuations = useValuations(a.id);
  const [correcting, setCorrecting] = useState<Valuation | null>(null);
  const [editing, setEditing] = useState(false);
  const v = a.latest_valuation;
  const fullOwnership = /^100(\.0+)?$/.test(a.ownership_pct);

  return (
    <>
      <PageHeader
        title={a.name}
        back={{ href: '/accounts', label: 'Accounts' }}
        description={`${typeLabel(a.type)} · ${COUNTRY_LABELS[a.country]} · ${a.currency} · ${a.kind === 'liability' ? 'Liability' : ACCESSIBILITY_LABELS[a.accessibility]}`}
        actions={
          <>
            {a.archived ? <Pill icon={<Archive aria-hidden />}>Archived</Pill> : null}
            {a.type === 'epf' ? (
              <Button asChild variant="outline">
                <Link href={`/accounts/${a.id}/epf`}>
                  <Building2 aria-hidden /> Edit EPF details
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <BalanceCard
            title={a.kind === 'liability' ? 'Amount owed' : 'Latest balance'}
            amount={v?.amount ?? null}
            currency={a.currency}
            verification={v?.verification_status ?? null}
            stale={a.stale}
            asOf={v?.as_of ?? null}
            size="lg"
            testId="balance-card">
            {!fullOwnership ? <p className="text-xs text-muted-foreground">You own {a.ownership_pct}% — net worth counts your share only.</p> : null}
            {a.stale ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-warning-strong dark:text-warning">
                <Clock className="size-3.5" aria-hidden /> Stale: the last valuation is older than 45 days (or missing). Add a new valuation.
              </p>
            ) : null}
          </BalanceCard>
          <QueryView query={valuations} loadingLabel="Loading history">
            {(data) => <ValuationHistory account={a} items={data.items} onCorrect={setCorrecting} />}
          </QueryView>
        </div>
        <div className="flex flex-col gap-5">
          <AppendValuation key={correcting?.id ?? 'new'} account={a} correcting={correcting} onDone={() => setCorrecting(null)} />
          <Card>
            <CardHeader className="justify-between">
              <CardTitle>Settings</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setEditing((e) => !e)} data-testid="edit-account">
                <Pencil aria-hidden /> {editing ? 'Close' : 'Edit'}
              </Button>
            </CardHeader>
            <CardContent>
              {editing ? (
                <EditAccount account={a} onDone={() => setEditing(false)} />
              ) : (
                <KeyValueList>
                  {a.kind === 'asset' ? <KeyValue label="Accessibility">{ACCESSIBILITY_LABELS[a.accessibility]}</KeyValue> : null}
                  {a.accessibility_override_note ? <KeyValue label="Override note">{a.accessibility_override_note}</KeyValue> : null}
                  {a.kind === 'asset' ? <KeyValue label="Can fund goals">{a.goal_eligible ? 'Yes' : 'No'}</KeyValue> : null}
                  <KeyValue label="In net worth">{a.include_in_net_worth ? 'Yes' : 'No'}</KeyValue>
                  <KeyValue label="Ownership">{`${a.ownership_pct}%`}</KeyValue>
                  <DetailSummary account={a} />
                  <KeyValue label="Version">{String(a.version)}</KeyValue>
                </KeyValueList>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function DetailSummary({ account: a }: { account: Account }) {
  const fields = detailFieldsFor(a.type);
  const values = payloadToDetails(a.type, a.details as Record<string, unknown>);
  return (
    <>
      {fields.map((f) => {
        const raw = values[f.key];
        if (raw === undefined || raw === '') return null;
        let shown: React.ReactNode = String(raw);
        if (typeof raw === 'boolean') shown = raw ? 'Yes' : 'No';
        else if (f.kind === 'money') shown = <Money value={raw} currency={a.currency} compact={false} />;
        else if (f.kind === 'percent') shown = `${raw}%`;
        else if (f.kind === 'date') shown = formatDate(raw);
        else if (f.kind === 'choice') shown = f.options?.find((o) => o.value === raw)?.label ?? raw;
        return (
          <KeyValue key={f.key} label={f.label}>
            {shown}
          </KeyValue>
        );
      })}
    </>
  );
}

function ValuationHistory({ account: a, items, onCorrect }: { account: Account; items: Valuation[]; onCorrect: (v: Valuation) => void }) {
  const effective = items.filter((v) => !v.superseded_by).sort((x, y) => x.as_of.localeCompare(y.as_of));
  return (
    <Card data-testid="valuation-history">
      <CardHeader className="flex-col">
        <CardTitle>Valuation history</CardTitle>
        <CardDescription>Append-only. Corrections add a new entry that supersedes the old one; nothing is overwritten.</CardDescription>
      </CardHeader>
      <CardContent className="gap-4">
        {effective.length >= 2 ? (
          <ProjectionChart
            title="Balance over time"
            xLabels={effective.map((v) => formatDate(v.as_of))}
            series={[{ key: 'balance', label: a.kind === 'liability' ? 'Owed' : 'Balance', values: effective.map((v) => v.amount) }]}
            currency={a.currency}
            testId="valuation-chart"
            height={240}
          />
        ) : null}
        {items.length === 0 ? <p className="text-sm text-muted-foreground">No valuations yet.</p> : null}
        <ul className="divide-y">
          {items.map((v) => (
            <li key={v.id} className={cn('flex flex-wrap items-start gap-3 py-3', v.superseded_by && 'opacity-75')}>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Money value={v.amount} currency={v.currency} className="font-semibold" strike={!!v.superseded_by} qualifier={v.superseded_by ? 'superseded' : undefined} />
                <div className="flex flex-wrap gap-1">
                  <ProvenancePill verification={v.verification_status} asOf={v.as_of} source={v.source} />
                  {v.superseded_by ? <Pill icon={<GitCommitHorizontal aria-hidden />}>Superseded by a correction</Pill> : null}
                  {v.supersedes_id ? (
                    <Pill kind="accent" icon={<Wrench aria-hidden />}>
                      Correction
                    </Pill>
                  ) : null}
                </div>
                {v.note ? <p className="text-xs text-muted-foreground">“{v.note}”</p> : null}
                <p className="text-xs text-muted-foreground">Recorded {formatTimestamp(v.created_at)}</p>
              </div>
              {!v.superseded_by ? (
                <Button variant="ghost" size="sm" aria-label={`Correct valuation from ${formatDate(v.as_of)}`} onClick={() => onCorrect(v)}>
                  Correct
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AppendValuation({ account: a, correcting, onDone }: { account: Account; correcting: Valuation | null; onDone: () => void }) {
  const { control, handleSubmit, reset } = useForm<ValuationForm>({
    resolver: zodResolver(valuationFormSchema),
    defaultValues: correcting
      ? { amount: correcting.amount, as_of: correcting.as_of, verification_status: correcting.verification_status, note: '' }
      : { amount: '', as_of: todayIso(), verification_status: 'verified', note: '' },
  });
  const add = useApiMutation(
    (api, f: ValuationForm) =>
      api.accounts.addValuation(a.id, {
        amount: parseMoneyInput(f.amount) ?? '0',
        as_of: f.as_of,
        verification_status: f.verification_status,
        source: 'manual',
        ...(f.note.trim() ? { note: f.note.trim() } : {}),
        ...(correcting ? { supersedes_id: correcting.id } : {}),
      }),
    {
      invalidate: [qk.valuations(a.id), qk.account(a.id), ...HOUSEHOLD_KEYS],
      onSuccess: () => {
        analytics.track('valuation_added', { account_type: a.type });
        reset({ amount: '', as_of: todayIso(), verification_status: 'verified', note: '' });
        onDone();
      },
    },
  );
  return (
    <Card data-testid="append-valuation" className={cn(correcting && 'border-primary')}>
      <CardHeader className="flex-col">
        <CardTitle>{correcting ? `Correct entry from ${formatDate(correcting.as_of)}` : 'Add a valuation'}</CardTitle>
        {correcting ? <CardDescription>The original entry stays in history, marked as superseded.</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit((f) => add.mutate(f))} noValidate>
          <MoneyField control={control} name="amount" label={a.kind === 'liability' ? 'Amount owed' : 'Balance'} currency={a.currency} />
          <DateField control={control} name="as_of" label="As of" />
          <ChoiceField
            control={control}
            name="verification_status"
            label="Status"
            options={[
              { value: 'verified', label: 'Verified' },
              { value: 'estimated', label: 'Estimated' },
            ]}
          />
          <TextField control={control} name="note" label={correcting ? 'Reason for correction' : 'Note (optional)'} multiline />
          <FormError error={add.error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={add.isPending} data-testid="save-valuation">
              <Plus aria-hidden /> {correcting ? 'Save correction' : 'Add valuation'}
            </Button>
            {correcting ? (
              <Button variant="ghost" onClick={onDone}>
                Cancel correction
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

const editSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the account a name').max(100),
    ownership_pct: z
      .string()
      .refine((v) => /^\d+(\.\d+)?$/.test(v) && compareDecimal(v, '0') > 0 && compareDecimal(v, '100') <= 0, 'Ownership must be more than 0 and at most 100'),
    accessibility: z.enum(ACCESSIBILITIES),
    accessibility_override_note: z.string(),
    goal_eligible: z.boolean(),
    include_in_net_worth: z.boolean(),
    type: z.string(),
    details: z.record(z.string(), z.union([z.string(), z.boolean()])),
  })
  .superRefine((v, ctx) => {
    if (v.accessibility !== defaultAccessibility(v.type as Account['type']) && v.accessibility_override_note.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['accessibility_override_note'], message: 'Explain why you changed the default accessibility' });
    }
    for (const [key, message] of Object.entries(validateDetails(v.type, v.details))) {
      ctx.addIssue({ code: 'custom', path: ['details', key], message });
    }
  });
type EditForm = z.infer<typeof editSchema>;

function EditAccount({ account: a, onDone }: { account: Account; onDone: () => void }) {
  const router = useRouter();
  // The version this edit is based on is fixed when the form opens: a background refetch must never
  // silently bump it, or a save would overwrite someone else's change (no last-write-wins).
  const [baseVersion] = useState(a.version);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { control, handleSubmit } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: a.name,
      ownership_pct: a.ownership_pct,
      accessibility: a.accessibility,
      accessibility_override_note: a.accessibility_override_note ?? '',
      goal_eligible: a.goal_eligible,
      include_in_net_worth: a.include_in_net_worth,
      type: a.type,
      details: payloadToDetails(a.type, a.details as Record<string, unknown>),
    },
  });
  const update = useApiMutation((api, body: AccountUpdate) => api.accounts.update(a.id, body), {
    invalidate: [qk.account(a.id), ...HOUSEHOLD_KEYS],
    onSuccess: onDone,
    // 409 VERSION_CONFLICT → resolve prompt; reloading closes the form so it reopens on the server copy.
    conflict: { entity: 'this account', onReload: onDone },
  });
  const remove = useApiMutation((api) => api.accounts.remove(a.id), {
    invalidate: HOUSEHOLD_KEYS,
    onSuccess: () => router.push('/accounts'),
  });
  const accessibility = useWatch({ control, name: 'accessibility' });
  const isAsset = a.kind === 'asset';
  const changedElsewhere = a.version !== baseVersion;

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={handleSubmit((f) =>
        update.mutate({
          name: f.name,
          ownership_pct: f.ownership_pct,
          include_in_net_worth: f.include_in_net_worth,
          details: detailsToPayload(a.type, f.details) as AccountUpdate['details'],
          ...(isAsset
            ? {
                accessibility: f.accessibility,
                goal_eligible: f.goal_eligible,
                accessibility_override_note: f.accessibility === defaultAccessibility(a.type) ? null : f.accessibility_override_note.trim(),
              }
            : {}),
          version: baseVersion,
        }),
      )}>
      {changedElsewhere ? (
        <p role="status" className="rounded-lg border border-dashed border-warning bg-warning-soft p-2 text-xs">
          This account changed on another device while you were editing. Saving will ask you to resolve the conflict.
        </p>
      ) : null}
      <TextField control={control} name="name" label="Name" />
      <TextField control={control} name="ownership_pct" label="Ownership (%)" inputMode="decimal" suffix="%" />
      {isAsset ? (
        <>
          <ChoiceField
            control={control}
            name="accessibility"
            label="Accessibility"
            options={ACCESSIBILITIES.map((x) => ({ value: x, label: ACCESSIBILITY_LABELS[x] }))}
          />
          {accessibility !== defaultAccessibility(a.type) ? (
            <TextField control={control} name="accessibility_override_note" label="Override note *" multiline />
          ) : null}
          <SwitchField control={control} name="goal_eligible" label="Can fund goals" />
        </>
      ) : null}
      <SwitchField control={control} name="include_in_net_worth" label="Include in net worth" />
      {detailFieldsFor(a.type).length > 0 ? (
        <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold">Details</legend>
          <DetailFieldsEditor control={control} type={a.type} currency={a.currency} />
        </fieldset>
      ) : null}
      <FormError error={update.error ?? remove.error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={update.isPending} data-testid="save-account-settings">
          Save changes
        </Button>
        <Button variant="outline" onClick={() => update.mutate({ archived: !a.archived, version: baseVersion })} data-testid="archive-account">
          {a.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          {a.archived ? 'Unarchive' : 'Archive'}
        </Button>
        <Button variant="danger" onClick={() => setConfirmDelete(true)} loading={remove.isPending}>
          <Trash2 aria-hidden /> Delete
        </Button>
      </div>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this account?"
        description="It will be removed from your net worth. History is retained for audit."
        actions={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDelete(false);
                remove.mutate();
              }}>
              Delete account
            </Button>
          </>
        }
      />
    </form>
  );
}
