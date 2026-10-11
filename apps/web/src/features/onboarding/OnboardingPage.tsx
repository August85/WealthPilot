'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { COUNTRIES, CURRENCIES } from '@wealthpilot/contracts';
import {
  COUNTRY_LABELS,
  analytics,
  emptyPeriod,
  householdFormSchema,
  residencyFormSchema,
  type ResidencyFormInput,
  type ResidencyFormOutput,
} from '@wealthpilot/shared';
import { AlertCircle, ArrowLeft, ArrowRight, Check, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';

import { FormError } from '@/components/app';
import { ChoiceField, SwitchRow, TextField } from '@/components/form';
import { Disclaimer } from '@/components/finance/finance';
import { Brand } from '@/components/shell/Brand';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthSession } from '@/lib/auth/context';
import { useApiMutation } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { cn } from '@/lib/utils';

import { ResidencyPeriodsEditor } from './ResidencyForm';

/**
 * S03 + S04 onboarding: residency (home country, reporting currency, tax residency periods, mandatory not-advice
 * acknowledgement), then household. The draft lives in memory only and is submitted once as POST /me/onboarding.
 */
export function OnboardingPage() {
  const [residency, setResidency] = useState<ResidencyFormOutput | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const auth = useAuthSession();
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b bg-card px-4 py-3 sm:px-8">
        <Brand />
        <Button variant="ghost" size="sm" onClick={() => void auth.signOut()}>
          Sign out
        </Button>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
        <ol className="flex gap-2 text-sm" aria-label="Progress">
          {['Residency', 'Household'].map((label, i) => {
            const n = (i + 1) as 1 | 2;
            return (
              <li key={label} className="flex flex-1 flex-col gap-1.5" aria-current={step === n ? 'step' : undefined}>
                <span className={cn('h-1.5 rounded-full', step >= n ? 'bg-primary' : 'bg-border')} />
                <span className={cn(step === n ? 'font-semibold' : 'text-muted-foreground')}>
                  Step {n} of 2 · {label}
                </span>
              </li>
            );
          })}
        </ol>
        {step === 1 ? (
          <ResidencyStep
            initial={residency}
            onNext={(v) => {
              setResidency(v);
              setStep(2);
            }}
          />
        ) : residency ? (
          <HouseholdStep residency={residency} onBack={() => setStep(1)} />
        ) : null}
      </main>
    </div>
  );
}

function ResidencyStep({ initial, onNext }: { initial: ResidencyFormOutput | null; onNext: (v: ResidencyFormOutput) => void }) {
  const { control, handleSubmit } = useForm<ResidencyFormInput, unknown, ResidencyFormOutput>({
    resolver: zodResolver(residencyFormSchema),
    defaultValues: initial
      ? { ...initial, tax_residency: initial.tax_residency.map((p) => ({ ...p, to_date: p.to_date ?? '' })) }
      : { home_country: 'US', reporting_currency: 'USD', tax_residency: [emptyPeriod()], disclaimer_accepted: false },
  });
  return (
    <form data-testid="onboarding-residency" noValidate onSubmit={handleSubmit(onNext)} className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Where are you based?</h1>
        <p className="mt-1 text-sm text-muted-foreground">This sets your defaults. Tax residency here is your own assumption — WealthPilot does not decide it.</p>
      </div>
      <Card>
        <CardContent className="gap-5">
          <ChoiceField control={control} name="home_country" label="Home country" options={COUNTRIES.map((c) => ({ value: c, label: COUNTRY_LABELS[c] }))} />
          <ChoiceField
            control={control}
            name="reporting_currency"
            label="Reporting currency"
            helper="You can switch between USD and INR at any time; balances keep their own currency."
            options={CURRENCIES.map((c) => ({ value: c, label: c === 'USD' ? '$ US dollar' : '₹ Indian rupee' }))}
          />
        </CardContent>
      </Card>
      <section className="flex flex-col gap-3" aria-labelledby="periods-heading">
        <h2 id="periods-heading" className="text-lg font-semibold">
          Tax residency periods
        </h2>
        <ResidencyPeriodsEditor control={control} />
      </section>
      <Disclaimer />
      <Controller
        control={control}
        name="disclaimer_accepted"
        render={({ field, fieldState }) => (
          <Card tone={fieldState.error ? 'danger' : 'default'}>
            <CardContent className="gap-2 py-3">
              <SwitchRow
                testId="disclaimer-switch"
                label="I understand WealthPilot is not tax, legal or investment advice"
                helper="Required to continue."
                checked={!!field.value}
                onCheckedChange={field.onChange}
              />
              {fieldState.error ? (
                <p role="alert" className="flex items-center gap-1 text-xs font-medium text-danger">
                  <AlertCircle className="size-3.5" aria-hidden /> {fieldState.error.message}
                </p>
              ) : null}
            </CardContent>
          </Card>
        )}
      />
      <Button type="submit" size="lg" className="w-fit" data-testid="residency-continue">
        Continue <ArrowRight aria-hidden />
      </Button>
    </form>
  );
}

function HouseholdStep({ residency, onBack }: { residency: ResidencyFormOutput; onBack: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { control, handleSubmit } = useForm<z.infer<typeof householdFormSchema>>({
    resolver: zodResolver(householdFormSchema),
    defaultValues: { household_name: 'Our household' },
  });
  const onboard = useApiMutation(
    (api, name: string) =>
      api.me.onboard({
        home_country: residency.home_country,
        reporting_currency: residency.reporting_currency,
        household_name: name,
        disclaimer_accepted: true,
        tax_residency: residency.tax_residency,
      }),
    {
      onSuccess: (me) => {
        qc.setQueryData(qk.me, me);
        analytics.track('onboarding_completed', { currency: me.reporting_currency });
        router.replace('/overview');
      },
    },
  );
  return (
    <form data-testid="onboarding-household" noValidate onSubmit={handleSubmit((v) => onboard.mutate(v.household_name))} className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Name your household</h1>
        <p className="mt-1 text-sm text-muted-foreground">Everything you add is grouped under this household.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Household</CardTitle>
        </CardHeader>
        <CardContent className="gap-4">
          <TextField control={control} name="household_name" label="Household name" />
          <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft p-3 text-sm">
            <User className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            For now a household has a single member — you. Sharing with a partner (with private accounts kept private) is planned for a later release.
          </p>
        </CardContent>
      </Card>
      <FormError error={onboard.error} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="lg" onClick={onBack}>
          <ArrowLeft aria-hidden /> Back
        </Button>
        <Button type="submit" size="lg" loading={onboard.isPending} data-testid="household-finish">
          <Check aria-hidden /> Finish setup
        </Button>
      </div>
    </form>
  );
}
