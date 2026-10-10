import { router, useLocalSearchParams } from 'expo-router';

import { ErrorState, LoadingState, Card, Screen, Stack, Text, Button } from '@/components/primitives';
import { Disclaimer } from '@/components/finance';
import { errorMessage } from '@/lib/hooks';

import {
  HomeResultView,
  MetricsCard,
  Reproducibility,
  RunWarnings,
  SensitivityView,
  YearlyView,
} from './results';
import { useRunContext } from './useRunContext';

/** Results for one run (feeds S14/S15/S18). Polls while queued/running. */
export default function RunResultScreen() {
  const { id, scenario } = useLocalSearchParams<{ id: string; scenario?: string }>();
  const { run, result, version, ctx } = useRunContext(id, scenario);

  return (
    <Screen testID="run-result">
      <RunStatusBanner status={run.data?.status} error={run.data?.error ?? (run.isError ? errorMessage(run.error) : null)} />
      {result.data ? (
        <Stack gap={16}>
          <MetricsCard result={result.data} ctx={ctx} />
          {result.data.home ? <HomeResultView home={result.data.home} result={result.data} ctx={ctx} /> : null}
          <YearlyView result={result.data} ctx={ctx} assumptions={version?.assumptions} />
          <SensitivityView result={result.data} />
          <RunWarnings result={result.data} />
          <Reproducibility result={result.data} />
          <Button
            label="Export PDF report"
            icon="document-outline"
            variant="secondary"
            onPress={() => router.push({ pathname: '/export', params: { run: result.data!.run_id } })}
          />
          <Disclaimer />
        </Stack>
      ) : result.isError ? (
        <ErrorState message={errorMessage(result.error)} onRetry={() => result.refetch()} />
      ) : null}
    </Screen>
  );
}

export function RunStatusBanner({ status, error }: { status?: string; error?: string | null }) {
  if (!status) return <LoadingState label="Loading run" />;
  if (status === 'queued' || status === 'running') {
    return (
      <Card tone="info" testID="run-pending">
        <LoadingState label={status === 'queued' ? 'Queued — waiting for a calculation worker' : 'Calculating'} />
      </Card>
    );
  }
  if (status === 'failed') {
    return (
      <Card tone="danger" testID="run-failed">
        <Text tone="danger" accessibilityRole="alert">
          ⚠ This run failed{error ? `: ${error}` : ''}. Check the assumptions and run again.
        </Text>
      </Card>
    );
  }
  return null;
}
