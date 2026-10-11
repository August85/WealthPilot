'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Me, ReportingCurrency } from '@wealthpilot/contracts';
import { COUNTRY_LABELS, PLAN_LABELS } from '@wealthpilot/shared';
import { ArrowLeftRight, Bell, BookOpen, Crown, Download, Flag, LogOut, MapPin, ShieldCheck, Wrench } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { SwitchRow, TextField } from '@/components/form';
import { FormError, LinkRow, PageHeader, QueryView } from '@/components/app';
import { CurrencyToggle } from '@/components/finance/finance';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { Pill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthSession } from '@/lib/auth/context';
import { useApiMutation, useMe } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { useUiStore } from '@/lib/store';

const nameSchema = z.object({ display_name: z.string().trim().max(100) });

/** Profile & settings hub (S12, S20–S24 entry points, display preferences). */
export function SettingsPage() {
  const me = useMe();
  return (
    <div data-testid="settings-screen">
      <PageHeader title="Settings" description="Your profile, display preferences and account." />
      <QueryView query={me} loadingLabel="Loading profile">
        {(m) => <SettingsBody me={m} />}
      </QueryView>
    </div>
  );
}

function SettingsBody({ me: m }: { me: Me }) {
  const { mode, signOut } = useAuthSession();
  const compact = useUiStore((s) => s.compactAmounts);
  const setCompact = useUiStore((s) => s.setCompactAmounts);
  const setDisplayCurrency = useUiStore((s) => s.setDisplayCurrency);
  const updateCurrency = useApiMutation((api, c: ReportingCurrency) => api.me.update({ reporting_currency: c }), {
    invalidate: [qk.me],
    // The profile default changed; drop any tab override so the new default shows.
    onSuccess: () => {
      setDisplayCurrency(null);
      toast.success('Default reporting currency saved');
    },
  });
  const { control, handleSubmit } = useForm<z.infer<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    defaultValues: { display_name: m.display_name ?? '' },
  });
  const updateName = useApiMutation((api, name: string) => api.me.update({ display_name: name }), {
    invalidate: [qk.me],
    onSuccess: () => toast.success('Name saved'),
  });

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader className="flex-col">
            <CardTitle>{m.display_name || m.email}</CardTitle>
            {m.display_name ? <CardDescription>{m.email}</CardDescription> : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill icon={<Crown aria-hidden />}>{PLAN_LABELS[m.entitlement]} plan</Pill>
              {m.home_country ? <Pill icon={<MapPin aria-hidden />}>{COUNTRY_LABELS[m.home_country]}</Pill> : null}
              {mode === 'dev' ? (
                <Pill kind="warn" icon={<Wrench aria-hidden />}>
                  Dev sign-in
                </Pill>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate onSubmit={handleSubmit((v) => updateName.mutate(v.display_name))}>
              <TextField control={control} name="display_name" label="Display name" className="flex-1" autoComplete="name" />
              <Button type="submit" variant="outline" loading={updateName.isPending}>
                Save name
              </Button>
            </form>
            <FormError error={updateName.error} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Display</CardTitle>
          </CardHeader>
          <CardContent className="gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Default reporting currency</p>
                <p className="text-xs text-muted-foreground">Saved to your profile. Balances keep their own currency; only the reporting view converts.</p>
              </div>
              <CurrencyToggle testId="default-currency" value={m.reporting_currency} onChange={(c) => c !== m.reporting_currency && updateCurrency.mutate(c)} />
            </div>
            <FormError error={updateCurrency.error} />
            <SwitchRow
              testId="compact-amounts"
              label="Short amounts (lakh/crore, K/M)"
              helper="Shows approximate short forms such as ≈ ₹12.35 L next to the exact amount."
              checked={compact}
              onCheckedChange={setCompact}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Theme</p>
                <p className="text-xs text-muted-foreground">Light, dark or follow your system.</p>
              </div>
              <ThemeToggle />
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Planning data</CardTitle>
          </CardHeader>
          <CardContent className="gap-1">
            <LinkRow href="/settings/residency" icon={Flag} title="Tax residency" subtitle="Your residency periods (your assumption)" testId="link-residency" />
            <LinkRow href="/fx" icon={ArrowLeftRight} title="FX assumptions" subtitle="USD/INR rate used for reporting" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="gap-1">
            <LinkRow href="/notifications" icon={Bell} title="Notifications" subtitle="Reminders and inbox" testId="link-notifications" />
            <LinkRow href="/export" icon={Download} title="Export data" subtitle="CSV, JSON or PDF report" testId="link-export" />
            <LinkRow href="/settings/security" icon={ShieldCheck} title="Privacy & security" subtitle="Sign-in methods, activity, delete account" testId="link-security" />
            <LinkRow href="/subscription" icon={Crown} title="Subscription" subtitle={`${PLAN_LABELS[m.entitlement]} plan`} testId="link-subscription" />
            <LinkRow href="/help" icon={BookOpen} title="Help & disclosures" testId="link-help" />
          </CardContent>
        </Card>
        <Button variant="outline" className="w-fit" onClick={() => void signOut()}>
          <LogOut aria-hidden /> Sign out
        </Button>
        <p className="text-xs text-muted-foreground">Signing out clears all cached data from this browser tab. Nothing financial is stored in your browser.</p>
      </div>
    </div>
  );
}
