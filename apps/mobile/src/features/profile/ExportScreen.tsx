import { useQuery } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Platform } from 'react-native';

import type { ExportCreate, ExportFormat, ExportJob, ExportScope } from '@wealthpilot/contracts';
import {
  EXPORT_FORMAT_LABELS as FORMAT_LABELS,
  EXPORT_SCOPE_LABELS as SCOPE_LABELS,
  buildExportRequest,
  formatsFor,
} from '@wealthpilot/shared';

import { FormError, MutationButton } from '@/components/app';
import { Button, Card, Chip, Icon, LoadingState, Row, Screen, Stack, Text } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import { useApi } from '@/lib/api';
import { formatTimestamp } from '@/lib/dates';
import { errorMessage, useApiMutation, useMe } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { useTheme } from '@/theme/ThemeProvider';

export { buildExportRequest, formatsFor };

/** S21 Data export: request, poll until ready, then open or share the short-lived download. */
export default function ExportScreen() {
  const { run } = useLocalSearchParams<{ run?: string }>();
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
    queryFn: ({ signal }) => api.exports.get(jobId!, { signal }),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.status === 'queued' || !q.state.data ? 1500 : false),
  });

  const pickScope = (s: ExportScope) => {
    setScope(s);
    if (!formatsFor(s).includes(format)) setFormat(formatsFor(s)[0]!);
    setJobId(null);
  };

  return (
    <Screen testID="export-screen">
      <Text variant="title">Export data</Text>
      <Text tone="muted">Your data belongs to you. Exports use stored results exactly — nothing is recalculated.</Text>

      <Card>
        <Text variant="label">What to export</Text>
        <Stack gap={8}>
          {(Object.keys(SCOPE_LABELS) as ExportScope[])
            .filter((s) => s !== 'run' || !!run)
            .map((s) => (
              <Chip
                key={s}
                label={SCOPE_LABELS[s].title}
                selected={scope === s}
                onPress={() => pickScope(s)}
                accessibilityLabel={`${SCOPE_LABELS[s].title}: ${SCOPE_LABELS[s].helper}`}
                testID={`scope-${s}`}
              />
            ))}
        </Stack>
        <Text variant="caption" tone="muted">
          {SCOPE_LABELS[scope].helper}
          {scope !== 'run' ? '. To export a run report, open a run result and choose Export.' : ''}
        </Text>
        <Text variant="label">Format</Text>
        <Row wrap gap={8} accessibilityRole="radiogroup" accessibilityLabel="Format">
          {formatsFor(scope).map((f) => (
            <Chip key={f} label={FORMAT_LABELS[f]} selected={format === f} onPress={() => setFormat(f)} testID={`format-${f}`} />
          ))}
        </Row>
        {me.data?.entitlement === 'free' && format === 'pdf' ? (
          <Text variant="caption" tone="muted" testID="watermark-note">
            On the Free plan, PDF reports carry a watermark.
          </Text>
        ) : null}
        <MutationButton
          label="Create export"
          icon="download-outline"
          loading={create.isPending}
          onPress={() => create.mutate(buildExportRequest(scope, format, run))}
          testID="create-export"
        />
        <FormError error={create.error} />
      </Card>

      {jobId ? (
        job.data ? (
          <ExportJobCard job={job.data} url={api.exports.resolveDownloadUrl(job.data)} />
        ) : job.error ? (
          <Text tone="danger">{errorMessage(job.error)}</Text>
        ) : (
          <LoadingState label="Preparing export" />
        )
      ) : null}
    </Screen>
  );
}

function ExportJobCard({ job, url }: { job: ExportJob; url: string | null }) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (!url) return;
    setError(null);
    setBusy(true);
    try {
      if (Platform.OS === 'web') {
        await WebBrowser.openBrowserAsync(url);
        return;
      }
      // The signed URL needs no bearer token; download to the cache and hand off to the share sheet.
      const file = await File.downloadFileAsync(url, Paths.cache, { idempotent: true });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { dialogTitle: 'WealthPilot export' });
      else await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the export.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="export-job" tone={job.status === 'failed' ? 'danger' : job.status === 'completed' ? 'success' : 'default'}>
      <Row>
        <Icon
          name={job.status === 'completed' ? 'checkmark-circle' : job.status === 'failed' ? 'close-circle' : 'hourglass-outline'}
          color={job.status === 'completed' ? t.colors.success : job.status === 'failed' ? t.colors.danger : t.colors.textMuted}
        />
        <Text variant="bodyStrong" style={{ flex: 1 }} accessibilityLiveRegion="polite">
          {job.status === 'completed' ? 'Export ready' : job.status === 'failed' ? 'Export failed' : 'Preparing export…'}
        </Text>
      </Row>
      <Text variant="caption" tone="muted">
        {FORMAT_LABELS[job.format]} · {SCOPE_LABELS[job.scope].title} · requested {formatTimestamp(job.created_at)}
      </Text>
      {job.status === 'completed' && url ? (
        <>
          <Button label={Platform.OS === 'web' ? 'Open download' : 'Open or share'} icon="share-outline" loading={busy} onPress={open} testID="open-export" />
          {job.expires_at ? (
            <Text variant="caption" tone="muted">
              The download link expires {formatTimestamp(job.expires_at)}. Request a new export after that.
            </Text>
          ) : null}
        </>
      ) : null}
      {error ? <Text tone="danger">{error}</Text> : null}
    </Card>
  );
}
