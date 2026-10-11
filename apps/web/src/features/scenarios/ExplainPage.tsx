'use client';

import { METRIC_LABELS, contextLabel, formatMetric, isRelatedWarning } from '@wealthpilot/shared';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

import { PageHeader, QueryView } from '@/components/app';
import { DataTable } from '@/components/charts';
import { ForecastLabels, KeyValue, WarningPanel } from '@/components/finance/finance';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRun, useRunResult } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/** S18 Explain calculation: formula, inputs, result and related warnings for one metric. */
export function ExplainPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const runId = params?.id;
  const metric = search?.get('metric') ?? undefined;
  const run = useRun(runId);
  const result = useRunResult(runId, run.data?.status === 'completed');
  return (
    <div data-testid="explain-screen">
      <QueryView query={result} loadingLabel="Loading calculation">
        {(r) => {
          const exp = r.explanations.find((e) => e.metric === metric) ?? r.explanations[0];
          if (!exp) {
            return (
              <>
                <PageHeader title="Explain calculation" back={{ href: `/runs/${r.run_id}`, label: 'Run results' }} />
                <p className="text-sm text-muted-foreground">No explanation is available for this run.</p>
              </>
            );
          }
          const label = METRIC_LABELS[exp.metric] ?? exp.metric;
          const related = r.warnings.filter((w) => isRelatedWarning(exp.metric, w.code));
          return (
            <>
              <PageHeader title={label} eyebrow="Explain calculation" back={{ href: `/runs/${r.run_id}`, label: 'Run results' }} />
              <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
                <div className="flex min-w-0 flex-col gap-5">
                  <ForecastLabels asOf={r.base_date} scenario={null} assumptions={contextLabel(null, r.input_hash)} />
                  <Card data-testid="explain-formula">
                    <CardHeader>
                      <CardTitle>Formula</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-sm whitespace-pre-wrap">{exp.formula}</pre>
                    </CardContent>
                  </Card>
                  <Card data-testid="explain-inputs">
                    <CardHeader>
                      <CardTitle>Inputs</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <DataTable caption="Inputs" columns={['Input', 'Value']} rows={Object.entries(exp.inputs).map(([k, v]) => [k, String(v)])} />
                    </CardContent>
                  </Card>
                  <Card data-testid="explain-result">
                    <CardHeader>
                      <CardTitle>Result</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <KeyValue label={label} className="text-base">
                        {formatMetric(exp.metric, exp.result, r.currency)}
                      </KeyValue>
                      <p className="text-xs text-muted-foreground">
                        Exact value: {String(exp.result)} {r.currency}. Calculated on the server (model {r.model_version}); the app does not recompute it.
                      </p>
                    </CardContent>
                  </Card>
                  <WarningPanel warnings={related} title="Related warnings" />
                </div>
                {r.explanations.length > 1 ? (
                  <Card className="h-fit">
                    <CardHeader>
                      <CardTitle>Other explanations</CardTitle>
                    </CardHeader>
                    <CardContent className="gap-1">
                      <nav aria-label="Explanations" className="flex flex-col gap-1">
                        {r.explanations.map((e) => (
                          <Link
                            key={e.metric}
                            href={`/runs/${r.run_id}/explain?metric=${encodeURIComponent(e.metric)}`}
                            aria-current={e.metric === exp.metric ? 'page' : undefined}
                            className={cn(
                              'rounded-lg px-3 py-2 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring',
                              e.metric === exp.metric && 'bg-accent-soft font-medium text-link',
                            )}>
                            {METRIC_LABELS[e.metric] ?? e.metric}
                          </Link>
                        ))}
                      </nav>
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </>
          );
        }}
      </QueryView>
    </div>
  );
}
