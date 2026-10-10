import { router, useLocalSearchParams } from 'expo-router';

import { QueryView } from '@/components/app';
import { DataTable } from '@/components/charts';
import { ForecastLabels, KeyValue, WarningPanel } from '@/components/finance';
import { Card, Chip, Row, Screen, Stack, Text } from '@/components/primitives';
import { useRun, useRunResult } from '@/lib/hooks';

import { METRIC_LABELS, contextLabel, formatMetric } from './results';

/** S18 Explain calculation: formula, inputs, result and related warnings for one metric. */
export default function ExplainScreen() {
  const { run: runId, metric } = useLocalSearchParams<{ run: string; metric?: string }>();
  const run = useRun(runId);
  const result = useRunResult(runId, run.data?.status === 'completed');
  return (
    <Screen testID="explain-screen">
      <QueryView query={result} loadingLabel="Loading calculation">
        {(r) => {
          const exp = r.explanations.find((e) => e.metric === metric) ?? r.explanations[0];
          if (!exp) return <Text>No explanation is available for this run.</Text>;
          const label = METRIC_LABELS[exp.metric] ?? exp.metric;
          const related = r.warnings.filter((w) => {
            const m = exp.metric;
            if (m.startsWith('home_')) return w.code.startsWith('HOME') || w.code === 'ILLUSTRATIVE_TAX' || w.code.startsWith('FX');
            if (m.includes('retirement') || m.includes('deficit')) return w.code.startsWith('RETIREMENT') || w.code.startsWith('EPF');
            return true;
          });
          return (
            <Stack gap={16}>
              <Text variant="title">{label}</Text>
              <ForecastLabels asOf={r.base_date} scenario={null} assumptions={contextLabel(null, r.input_hash)} />
              <Card testID="explain-formula">
                <Text variant="heading">Formula</Text>
                <Text variant="body" tabular selectable accessibilityLabel={`Formula: ${exp.formula}`}>
                  {exp.formula}
                </Text>
              </Card>
              <Card testID="explain-inputs">
                <Text variant="heading">Inputs</Text>
                <DataTable caption="Inputs" columns={['Input', 'Value']} rows={Object.entries(exp.inputs).map(([k, v]) => [k, String(v)])} />
              </Card>
              <Card testID="explain-result">
                <Text variant="heading">Result</Text>
                <KeyValue label={label}>{formatMetric(exp.metric, exp.result, r.currency)}</KeyValue>
                <Text variant="caption" tone="muted">
                  Exact value: {String(exp.result)} {r.currency}. Calculated on the server (model {r.model_version}); the app does not
                  recompute it.
                </Text>
              </Card>
              <WarningPanel warnings={related} title="Related warnings" />
              {r.explanations.length > 1 ? (
                <Card>
                  <Text variant="heading">Other explanations</Text>
                  <Row wrap gap={8}>
                    {r.explanations.map((e) => (
                      <Chip
                        key={e.metric}
                        label={METRIC_LABELS[e.metric] ?? e.metric}
                        selected={e.metric === exp.metric}
                        onPress={() => router.setParams({ metric: e.metric })}
                      />
                    ))}
                  </Row>
                </Card>
              ) : null}
            </Stack>
          );
        }}
      </QueryView>
    </Screen>
  );
}
