'use client';

import { useQuery } from '@tanstack/react-query';
import type { ExportCreate, ExportFormat, ExportJob, ExportScope } from '@wealthpilot/contracts';
import {
  EXPORT_FORMAT_LABELS,
  EXPORT_SCOPE_LABELS,
  analytics,
  buildExportRequest,
  exportFileName,
  formatTimestamp,
  formatsFor,
  todayIso,
} from '@wealthpilot/shared';
import { CheckCircle2, Download, Hourglass, Loader2, XCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { ChipGroup } from '@/components/form';
import { FormError, PageHeader } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/lib/api';
import { useApiMutation, useMe } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { cn } from '@/lib/utils';

/** S21 Data export: request, poll until ready, then download the short-lived file. */
export function ExportPage() {
  const search = useSearchParams();
  const run = search?.get('run') ?? undefined;
  const api = useApi();
  const me = useMe();
  const [scope, setScope] = useState<ExportScope>(run ? 'run' : 'balances');
  const [format, setFormat] = useState<ExportFormat>(run ? 'pdf' : 'csv');
  const [jobId, setJobId] = useState<string | null>(null);

  const create = useApiMutation((a, body: ExportCreate) => a.exports.create(body), {
    onSuccess: (job) => {
      setJobId(job.id);
      analytics.track('export_requested', { format: job.format });
    },
  });

  const job = useQuery({
    queryKey: qk.exportJob(jobId ?? ''),
    queryFn: ({ signal }) => api.exports.get(jobId ?? '', { signal }),
    enabled: !!jobId,
    refetchInterval: (q) => (!q.state.data || q.state.data.status === 'queued' ? 1500 : false),
  });

  const pickScope = (s: ExportScope) => {
    setScope(s);
    const allowed = formatsFor(s);
    if (!allowed.includes(format) && allowed[0]) setFormat(allowed[0]);
    setJobId(null);
  };
  const scopes = (Object.keys(EXPORT_SCOPE_LABELS) as ExportScope[]).filter((s) => s !== 'run' || !!run);

  return (
    <div data-testid="export-screen">
      <PageHeader title="Export data" description="Your data belongs to you. Exports use stored results exactly — nothing is recalculated." />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardContent className="gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">What to export</legend>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What to export">
                {scopes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={scope === s}
                    data-testid={`scope-${s}`}
                    onClick={() => pickScope(s)}
                    className={cn(
                      'flex cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-ring',
                      scope === s ? 'border-primary bg-accent-soft' : 'hover:bg-muted',
                    )}>
                    <span className="text-sm font-semibold">{EXPORT_SCOPE_LABELS[s].title}</span>
                    <span className="text-xs text-muted-foreground">{EXPORT_SCOPE_LABELS[s].helper}</span>
                  </button>
                ))}
              </div>
              {scope !== 'run' ? <p className="text-xs text-muted-foreground">To export a run report, open a run result and choose Export PDF report.</p> : null}
            </fieldset>
            <div className="flex flex-col gap-2">
              <span id="format-label" className="text-sm font-medium">
                Format
              </span>
              <ChipGroup<ExportFormat>
                labelledBy="format-label"
                value={format}
                onChange={setFormat}
                options={formatsFor(scope).map((f) => ({ value: f, label: EXPORT_FORMAT_LABELS[f] }))}
                testIdPrefix="format"
              />
              {me.data?.entitlement === 'free' && format === 'pdf' ? (
                <p className="text-xs text-muted-foreground" data-testid="watermark-note">
                  On the Free plan, PDF reports carry a watermark.
                </p>
              ) : null}
            </div>
            <FormError error={create.error} />
            <Button className="w-fit" loading={create.isPending} onClick={() => create.mutate(buildExportRequest(scope, format, run))} data-testid="create-export">
              <Download aria-hidden /> Create export
            </Button>
          </CardContent>
        </Card>
        <div>
          {jobId ? (
            job.data ? (
              <ExportJobCard job={job.data} url={api.exports.resolveDownloadUrl(job.data)} />
            ) : job.error ? (
              <FormError error={job.error} />
            ) : (
              <Card>
                <CardContent className="flex-row items-center gap-2" role="status">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Preparing export…
                </CardContent>
              </Card>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Downloads the signed URL (no bearer token needed) and saves it with a descriptive file name. */
async function downloadFile(url: string, fileName: string) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(res.status === 403 || res.status === 404 || res.status === 410 ? 'This download link has expired. Create a new export.' : `Download failed (HTTP ${res.status}).`);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }
}

function ExportJobCard({ job, url }: { job: ExportJob; url: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = job.status === 'completed';
  const failed = job.status === 'failed';
  const Icon = done ? CheckCircle2 : failed ? XCircle : Hourglass;
  const download = async () => {
    if (!url) return;
    setError(null);
    setBusy(true);
    try {
      await downloadFile(url, exportFileName(job.scope, job.format, todayIso()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not download the export.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-testid="export-job" tone={failed ? 'danger' : done ? 'success' : 'default'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" aria-live="polite">
          <Icon className={cn('size-5', done ? 'text-success' : failed ? 'text-danger' : 'text-muted-foreground')} aria-hidden />
          {done ? 'Export ready' : failed ? 'Export failed' : 'Preparing export…'}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-3">
        <p className="text-xs text-muted-foreground">
          {EXPORT_FORMAT_LABELS[job.format]} · {EXPORT_SCOPE_LABELS[job.scope].title} · requested {formatTimestamp(job.created_at)}
        </p>
        {done && url ? (
          <>
            <Button onClick={() => void download()} loading={busy} data-testid="download-export" className="w-fit">
              <Download aria-hidden /> Download
            </Button>
            {job.expires_at ? <p className="text-xs text-muted-foreground">The download link expires {formatTimestamp(job.expires_at)}. Request a new export after that.</p> : null}
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
