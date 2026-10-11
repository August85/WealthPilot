'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { isApiError, positiveDecimal } from '@wealthpilot/contracts';
import { formatDate, formatNumber, todayIso } from '@wealthpilot/shared';
import { AlertCircle, ArrowDown, Check, CheckCircle2, Clock, Globe } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormError, PageHeader } from '@/components/app';
import { DateField, TextField } from '@/components/form';
import { FxProvenance } from '@/components/finance/finance';
import { Pill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { useApi } from '@/lib/api';
import { useApiMutation, useFxRate } from '@/lib/hooks';
import { qk } from '@/lib/query';

export const fxFormSchema = z.object({
  rate: positiveDecimal,
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
});
type FxForm = z.infer<typeof fxFormSchema>;

/**
 * S12 FX assumptions. Your saved USD/INR rate is the only rate used in calculations. The reference rate is a
 * suggestion only and is never used unless you save it as your rate.
 */
export function FxPage() {
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
  const save = useApiMutation((a, f: FxForm) => a.fx.saveRate({ base: 'USD', quote: 'INR', rate: f.rate, as_of: f.as_of }), {
    invalidate: [qk.fxAll, qk.netWorthAll, ['net-worth-history'], qk.insightsAll, ['scenario-defaults'], qk.goals],
    onSuccess: () => toast.success('Rate saved. Totals now use this rate.'),
  });
  const missing = userRate.isError && isApiError(userRate.error) && userRate.error.code === 'FX_RATE_MISSING';

  return (
    <div data-testid="fx-screen">
      <PageHeader
        title="FX assumptions"
        description="WealthPilot converts INR and USD with the rate you choose. It never silently uses a market feed."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Card data-testid="user-rate">
            <CardHeader>
              <CardTitle>Your planning rate</CardTitle>
            </CardHeader>
            <CardContent>
              {userRate.isLoading ? <Skeleton className="h-16" /> : null}
              {userRate.data ? (
                <>
                  <FxProvenance rates={[userRate.data]} />
                  {userRate.data.stale ? (
                    <p className="flex items-center gap-2 rounded-lg border border-dashed border-warning bg-warning-soft p-3 text-sm">
                      <Clock className="size-4 shrink-0" aria-hidden /> Your rate is more than 7 days old. Consider saving an updated rate.
                    </p>
                  ) : null}
                </>
              ) : null}
              {missing ? (
                <p role="status" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm" data-testid="fx-missing">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                  No USD/INR rate saved. Accounts in the other currency are excluded from totals until you save one (never silently converted).
                </p>
              ) : null}
              {userRate.isError && !missing ? <FormError error={userRate.error} /> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-col">
              <CardTitle>Save a new rate</CardTitle>
              <CardDescription>Saved rates are kept with their date, so past reports stay reproducible.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit((f) => save.mutate(f))}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField control={control} name="rate" label="INR per 1 USD" inputMode="decimal" placeholder="e.g. 85.00" />
                  <DateField control={control} name="as_of" label="Rate date" />
                </div>
                <FormError error={save.error} />
                {save.isSuccess ? (
                  <p role="status" className="flex items-center gap-1.5 text-sm text-success">
                    <CheckCircle2 className="size-4" aria-hidden /> Saved. Totals now use this rate.
                  </p>
                ) : null}
                <Button type="submit" loading={save.isPending} data-testid="save-fx" className="w-fit">
                  <Check aria-hidden /> Save my rate
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
        <Card data-testid="reference-rate" tone="info" className="h-fit">
          <CardHeader className="flex-col">
            <CardTitle className="flex items-center gap-2">
              <Globe className="size-4 text-info" aria-hidden /> Reference rate
            </CardTitle>
            <Pill kind="warn">Reference only, not used unless you save it</Pill>
          </CardHeader>
          <CardContent>
            {reference.data ? (
              <div className="flex flex-col gap-2">
                <p className="text-lg font-semibold tabular">
                  1 USD = {formatNumber(reference.data.rate, { decimals: 4, grouping: 'western' })} INR
                </p>
                <p className="text-sm text-muted-foreground">As of {formatDate(reference.data.as_of)}</p>
                <p className="text-xs text-muted-foreground">
                  {reference.data.provider}. Free ECB-based reference data, not a licensed or tradable rate; excludes fees and spread
                  {reference.data.stale ? '. This cached value is stale — the feed may be down.' : '.'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  title="Copies the reference rate into the form. It is not used until you save."
                  onClick={() => {
                    setValue('rate', reference.data.rate);
                    setValue('as_of', reference.data.as_of);
                  }}>
                  <ArrowDown aria-hidden /> Use this as my rate
                </Button>
              </div>
            ) : reference.isError ? (
              <p className="text-sm text-muted-foreground" data-testid="reference-unavailable">
                Reference feed unavailable right now. Enter your own rate.
              </p>
            ) : (
              <Skeleton className="h-16" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
