'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ACCESSIBILITIES, COUNTRIES, CURRENCIES, type AccountKind, type AccountType } from '@wealthpilot/contracts';
import {
  ACCESSIBILITY_HELP,
  ACCESSIBILITY_LABELS,
  ACCOUNT_TEMPLATES,
  COUNTRY_LABELS,
  addAccountFormSchema,
  analytics,
  buildAccountCreate,
  defaultAccessibility,
  defaultAddAccountValues,
  suggested401kTotal,
  templateFor,
  type AddAccountForm,
} from '@wealthpilot/shared';
import { AlertTriangle, Check, CheckCircle2, CircleHelp, Info, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { FormError, PageHeader } from '@/components/app';
import { ChoiceField, DateField, MoneyField, SwitchField, TextField } from '@/components/form';
import { Money } from '@/components/finance/Money';
import { CatalogIcon } from '@/components/icons';
import { Pill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HOUSEHOLD_KEYS } from '@/lib/query';
import { useApiMutation } from '@/lib/hooks';

import { DetailFieldsEditor } from './DetailFieldsEditor';

/** S05 Add asset/account — guided templates per type (including liabilities). */
export function AddAccountPage() {
  const [type, setType] = useState<AccountType | null>(null);
  const [kind, setKind] = useState<AccountKind>('asset');
  if (!type) return <TemplatePicker kind={kind} onKind={setKind} onPick={setType} />;
  return <AccountForm key={type} type={type} onBack={() => setType(null)} />;
}

function TemplatePicker({ kind, onKind, onPick }: { kind: AccountKind; onKind: (k: AccountKind) => void; onPick: (t: AccountType) => void }) {
  return (
    <div data-testid="add-account-picker">
      <PageHeader title="What would you like to add?" back={{ href: '/accounts', label: 'Accounts' }} />
      <div className="flex flex-col gap-5">
        <div className="flex gap-2" role="group" aria-label="Asset or liability">
          {(['asset', 'liability'] as const).map((k) => (
            <Button key={k} variant={kind === k ? 'default' : 'outline'} aria-pressed={kind === k} onClick={() => onKind(k)} data-testid={`kind-${k}`}>
              {k === 'asset' ? 'Asset' : 'Liability (debt)'}
            </Button>
          ))}
        </div>
        <Card tone="info">
          <CardContent className="flex-row flex-wrap items-center gap-3 py-3">
            <Info className="size-4 text-info" aria-hidden />
            <p className="flex-1 text-sm">RSU grants are tracked separately so vested and unvested shares are never mixed.</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/rsu/new">
                <TrendingUp aria-hidden /> Add an RSU grant instead
              </Link>
            </Button>
          </CardContent>
        </Card>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ACCOUNT_TEMPLATES.filter((tpl) => tpl.kind === kind).map((tpl) => (
            <li key={tpl.type}>
              <button
                type="button"
                data-testid={`template-${tpl.type}`}
                onClick={() => onPick(tpl.type)}
                className="flex h-full w-full cursor-pointer flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left shadow-card transition-colors hover:border-primary hover:bg-accent-soft/40 focus-visible:outline-2 focus-visible:outline-ring">
                <span className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-link">
                  <CatalogIcon name={tpl.icon} className="size-5" />
                </span>
                <span className="font-semibold">{tpl.label}</span>
                <span className="text-sm text-muted-foreground">{tpl.description}</span>
                <span className="mt-auto text-xs text-muted-foreground">
                  {COUNTRY_LABELS[tpl.country]} · {tpl.currency}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AccountForm({ type, onBack }: { type: AccountType; onBack: () => void }) {
  const router = useRouter();
  const tpl = templateFor(type);
  const { control, handleSubmit, setValue } = useForm<AddAccountForm>({
    resolver: zodResolver(addAccountFormSchema),
    defaultValues: defaultAddAccountValues(type),
  });
  const accessibility = useWatch({ control, name: 'accessibility' });
  const currency = useWatch({ control, name: 'currency' });
  const details = useWatch({ control, name: 'details' });
  const verification = useWatch({ control, name: 'verification_status' });
  const isAsset = tpl?.kind !== 'liability';
  const overridden = isAsset && accessibility !== defaultAccessibility(type);
  const suggestion = type === 'retirement_401k' ? suggested401kTotal(details ?? {}) : null;

  const create = useApiMutation((api, body: ReturnType<typeof buildAccountCreate>) => api.accounts.create(body), {
    invalidate: HOUSEHOLD_KEYS,
    onSuccess: (account) => {
      analytics.track('account_created', { account_type: account.type, country: account.country });
      router.replace(`/accounts/${account.id}`);
    },
  });

  const onSubmit = handleSubmit((v) => create.mutate(buildAccountCreate(v)));

  return (
    <form data-testid="add-account-form" onSubmit={onSubmit} noValidate>
      <PageHeader
        title={tpl?.label ?? 'Account'}
        description={tpl?.description}
        back={{ href: '/accounts', label: 'Accounts' }}
        actions={
          <Button variant="outline" onClick={onBack}>
            Change type
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          {tpl?.tip ? (
            <Card tone="info">
              <CardContent className="flex-row items-start gap-2 py-3 text-sm">
                <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                {tpl.tip}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Basics</CardTitle>
            </CardHeader>
            <CardContent className="gap-4">
              <TextField control={control} name="name" label="Name" helper="Use a nickname — no account numbers needed." />
              <ChoiceField control={control} name="country" label="Country" options={COUNTRIES.map((c) => ({ value: c, label: COUNTRY_LABELS[c] }))} />
              <ChoiceField
                control={control}
                name="currency"
                label="Currency (native)"
                options={CURRENCIES.map((c) => ({ value: c, label: c === 'USD' ? '$ USD' : '₹ INR' }))}
              />
              <TextField control={control} name="ownership_pct" label="Your ownership (%)" inputMode="decimal" suffix="%" helper="Use less than 100 for joint ownership." />
              <SwitchField control={control} name="include_in_net_worth" label="Include in net worth" />
            </CardContent>
          </Card>
          {isAsset ? (
            <Card>
              <CardHeader>
                <CardTitle>Accessibility</CardTitle>
              </CardHeader>
              <CardContent className="gap-4">
                <ChoiceField
                  control={control}
                  name="accessibility"
                  label="How accessible is this money?"
                  options={ACCESSIBILITIES.map((a) => ({
                    value: a,
                    label: `${ACCESSIBILITY_LABELS[a]}${a === defaultAccessibility(type) ? ' (default)' : ''}`,
                  }))}
                  helper={ACCESSIBILITY_HELP[accessibility]}
                />
                {overridden ? (
                  <TextField
                    control={control}
                    name="accessibility_override_note"
                    label="Why are you overriding the default? *"
                    helper="Saved as an audit note on the account."
                    multiline
                  />
                ) : null}
                <SwitchField
                  control={control}
                  name="goal_eligible"
                  label="Can fund goals"
                  helper="Default is on only for liquid assets. Retirement funds and unvested equity are excluded by default."
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="gap-4">
              <DetailFieldsEditor control={control} type={type} currency={currency} />
              {type === 'epf' ? (
                <p className="flex items-start gap-2 rounded-lg border border-dashed border-warning bg-warning-soft p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-strong dark:text-warning" aria-hidden />
                  EPF withdrawal and taxability are not determined from account age. Mark access as verified only after checking with a qualified professional.
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-col">
              <CardTitle>{tpl?.kind === 'liability' ? 'Amount owed' : 'Current balance'}</CardTitle>
              <CardDescription>Optional now; you can add it later. Stored exactly as entered.</CardDescription>
            </CardHeader>
            <CardContent className="gap-4">
              <MoneyField
                control={control}
                name="amount"
                label={tpl?.kind === 'liability' ? 'Amount owed (positive number)' : 'Balance'}
                currency={currency}
                helper={currency === 'INR' ? 'Indian grouping like 8,50,000 is fine.' : undefined}
              />
              {suggestion ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  Pre-tax + Roth = <Money value={suggestion} currency={currency} compact={false} />
                  <Button variant="ghost" size="sm" onClick={() => setValue('amount', suggestion)}>
                    Use as balance
                  </Button>
                </div>
              ) : null}
              <DateField control={control} name="as_of" label="Balance as of" />
              <ChoiceField
                control={control}
                name="verification_status"
                label="How sure are you?"
                options={[
                  { value: 'estimated', label: 'Estimated' },
                  { value: 'verified', label: 'Verified from a statement' },
                ]}
              />
              <div>
                {verification === 'estimated' ? (
                  <Pill kind="warn" icon={<CircleHelp aria-hidden />}>
                    Shown as estimated until you verify it
                  </Pill>
                ) : (
                  <Pill kind="ok" icon={<CheckCircle2 aria-hidden />}>
                    Verified
                  </Pill>
                )}
              </div>
              <TextField control={control} name="valuation_note" label="Note (optional)" multiline />
            </CardContent>
          </Card>
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-3">
        <FormError error={create.error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={create.isPending} data-testid="save-account">
            <Check aria-hidden /> Save account
          </Button>
          <Button variant="ghost" onClick={() => router.push('/accounts')}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

