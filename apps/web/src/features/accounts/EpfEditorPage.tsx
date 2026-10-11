'use client';

import type { Account, AccountUpdate } from '@wealthpilot/contracts';
import { detailsToPayload, parseMoneyInput, payloadToDetails, sumDec, validateDetails, type DetailFormValues } from '@wealthpilot/shared';
import { AlertTriangle, Check, Lock, User } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { FormError, PageHeader, QueryView } from '@/components/app';
import { BalanceCard } from '@/components/finance/finance';
import { Money } from '@/components/finance/Money';
import { Pill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAccount, useApiMutation } from '@/lib/hooks';
import { HOUSEHOLD_KEYS, qk } from '@/lib/query';

import { DetailFieldsEditor } from './DetailFieldsEditor';

/** S11 EPF editor: components, contributions, rate, access status (manual, never inferred). */
export function EpfEditorPage() {
  const params = useParams<{ id: string }>();
  const account = useAccount(params?.id);
  return (
    <div data-testid="epf-editor">
      <QueryView query={account}>{(a) => <EpfForm key={a.id} account={a} />}</QueryView>
    </div>
  );
}

function EpfForm({ account: a }: { account: Account }) {
  const router = useRouter();
  const [baseVersion] = useState(a.version);
  const { control, handleSubmit, setError } = useForm<{ details: DetailFormValues }>({
    defaultValues: { details: payloadToDetails('epf', a.details as Record<string, unknown>) },
  });
  const details = useWatch({ control, name: 'details' });
  const access = details?.access_status;
  const componentsTotal = sumDec([
    parseMoneyInput(String(details?.employee_component ?? '')) ?? '0',
    parseMoneyInput(String(details?.employer_component ?? '')) ?? '0',
  ]).toFixed(2);

  const save = useApiMutation(
    (api, d: DetailFormValues) =>
      api.accounts.update(a.id, { details: detailsToPayload('epf', d) as AccountUpdate['details'], version: baseVersion }),
    {
      invalidate: [qk.account(a.id), ...HOUSEHOLD_KEYS],
      onSuccess: () => router.push(`/accounts/${a.id}`),
      conflict: { entity: 'this EPF account', onReload: () => router.push(`/accounts/${a.id}`) },
    },
  );

  const onSubmit = handleSubmit((v) => {
    const errs = validateDetails('epf', v.details);
    const keys = Object.keys(errs);
    if (keys.length) {
      for (const k of keys) setError(`details.${k}`, { message: errs[k] });
      return;
    }
    save.mutate(v.details);
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader title={`${a.name} · EPF details`} back={{ href: `/accounts/${a.id}`, label: a.name }} />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Components and contributions</CardTitle>
          </CardHeader>
          <CardContent className="gap-4">
            {a.version !== baseVersion ? (
              <p role="status" className="rounded-lg border border-dashed border-warning bg-warning-soft p-2 text-xs">
                This account changed on another device while you were editing. Saving will ask you to resolve the conflict.
              </p>
            ) : null}
            <DetailFieldsEditor control={control} type="epf" currency={a.currency} />
            <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
              Employee + employer components: <Money value={componentsTotal} currency={a.currency} compact={false} className="font-medium text-foreground" />
            </p>
            <p className="text-xs text-muted-foreground">To change the balance itself, add a valuation on the account page (history is append-only).</p>
            <FormError error={save.error} />
            <Button type="submit" loading={save.isPending} data-testid="save-epf" className="w-fit">
              <Check aria-hidden /> Save EPF details
            </Button>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-5">
          <BalanceCard
            title="Latest recorded balance"
            amount={a.latest_valuation?.amount ?? null}
            currency={a.currency}
            verification={a.latest_valuation?.verification_status}
            stale={a.stale}
            asOf={a.latest_valuation?.as_of}
            size="md"
          />
          <Card tone="warning" data-testid="epf-warning">
            <CardContent>
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="size-4 text-warning-strong dark:text-warning" aria-hidden /> Professional verification needed
              </p>
              <p className="text-sm">
                EPF withdrawal eligibility and taxability depend on your employment, residency and the rules in force. WealthPilot never asserts them
                from account age. Planning treats EPF as restricted unless you mark access as verified.
              </p>
              {access === 'user_verified_accessible' ? (
                <Pill kind="warn" icon={<User aria-hidden />}>
                  You marked access as verified (your responsibility)
                </Pill>
              ) : (
                <Pill icon={<Lock aria-hidden />}>Treated as not accessible</Pill>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
