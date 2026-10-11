'use client';

import { formatTimestamp } from '@wealthpilot/shared';
import { AlertCircle, FileText, Loader2, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

import { ErrorState, LoadingState, PageHeader } from '@/components/app';
import { Disclaimer } from '@/components/finance/finance';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { errorMessage } from '@/lib/hooks';

import { HomeResultView, MetricsCard, Reproducibility, RunWarnings, SensitivityView, YearlyView } from './results';
import { useRunContext } from './useRunContext';

/** Results for one run (feeds S14/S15/S18). Polls while queued/running. */
export function RunResultPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const scenarioId = search?.get('scenario') ?? undefined;
  const { run, result, scenario, version, ctx } = useRunContext(params?.id, scenarioId);
  const r = result.data;

  return (
    <div data-testid="run-result">
      <PageHeader
        title={scenario.data ? `${scenario.data.name} · results` : 'Run results'}
        back={scenarioId ? { href: `/scenarios/${scenarioId}`, label: scenario.data?.name ?? 'Scenario' } : { href: '/scenarios', label: 'Scenarios' }}
        description={run.data ? `Run started ${formatTimestamp(run.data.created_at)}${version ? ` · assumptions v${version.number}` : ''}` : undefined}
        actions={
          r ? (
            <>
              {scenarioId ? (
                <Button asChild variant="outline">
                  <Link href={`/scenarios/${scenarioId}`}>
                    <Pencil aria-hidden /> Edit assumptions
                  </Link>
                </Button>
              ) : null}
              <Button asChild data-testid="export-pdf">
                <Link href={`/export?run=${r.run_id}`}>
                  <FileText aria-hidden /> Export PDF report
                </Link>
              </Button>
            </>
          ) : null
        }
      />
      <RunStatusBanner status={run.data?.status} error={run.data?.error ?? (run.isError ? errorMessage(run.error) : null)} />
      {r ? (
        <div className="flex flex-col gap-5">
          <MetricsCard result={r} ctx={ctx} />
          {r.home ? <HomeResultView home={r.home} result={r} ctx={ctx} /> : null}
          <YearlyView result={r} ctx={ctx} assumptions={version?.assumptions} />
          <div className="grid gap-5 xl:grid-cols-2">
            <SensitivityView result={r} />
            <Reproducibility result={r} />
          </div>
          <RunWarnings result={r} />
          <Disclaimer />
        </div>
      ) : result.isError ? (
        <ErrorState message={errorMessage(result.error)} onRetry={() => void result.refetch()} />
      ) : null}
    </div>
  );
}

export function RunStatusBanner({ status, error }: { status?: string; error?: string | null }) {
  if (!status) return error ? <ErrorState message={error} /> : <LoadingState label="Loading run" rows={2} />;
  if (status === 'queued' || status === 'running') {
    return (
      <Card tone="info" data-testid="run-pending" className="mb-5">
        <CardContent className="flex-row items-center gap-3" role="status" aria-live="polite">
          <Loader2 className="size-5 animate-spin text-info" aria-hidden />
          {status === 'queued' ? 'Queued — waiting for a calculation worker…' : 'Calculating…'}
        </CardContent>
      </Card>
    );
  }
  if (status === 'failed') {
    return (
      <Card tone="danger" data-testid="run-failed" className="mb-5">
        <CardContent className="flex-row items-start gap-2" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          This run failed{error ? `: ${error}` : ''}. Check the assumptions and run again.
        </CardContent>
      </Card>
    );
  }
  return null;
}
