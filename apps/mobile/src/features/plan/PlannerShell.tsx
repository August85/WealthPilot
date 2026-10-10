import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';

import type { Scenario, ScenarioKind } from '@wealthpilot/contracts';

import { FormError, MutationButton, QueryView } from '@/components/app';
import { Pill } from '@/components/finance';
import { Button, Card, Chip, EmptyState, Row, Stack, Text } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import { useApiMutation, useScenarios } from '@/lib/hooks';
import { qk } from '@/lib/query';

/**
 * Picks the scenario a planner works on (filtered by kind), and offers run / edit actions.
 * Renders `children(selectedScenario)`.
 */
export function PlannerShell({
  kinds,
  newKind,
  emptyTitle,
  focus,
  children,
}: {
  kinds: ScenarioKind[];
  newKind: ScenarioKind;
  emptyTitle: string;
  focus: string;
  children: (s: Scenario) => ReactNode;
}) {
  const scenarios = useScenarios();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const run = useApiMutation((api, versionId: string) => api.runs.create(versionId, { seed: null }), {
    invalidate: [qk.scenariosAll, ['scenario']],
    onSuccess: () => analytics.track('scenario_run_requested', { scenario_kind: newKind }),
  });

  return (
    <QueryView query={scenarios} loadingLabel="Loading scenarios">
      {(data) => {
        const list = data.items.filter((s) => kinds.includes(s.kind));
        if (list.length === 0) {
          return (
            <EmptyState
              icon={newKind === 'home' ? 'home-outline' : 'sunny-outline'}
              title={emptyTitle}
              body="Create a scenario from a preset. Your accounts, RSUs and FX rate are captured automatically."
              actionLabel="Create scenario"
              onAction={() => router.push({ pathname: '/scenarios/new', params: { kind: newKind } })}
            />
          );
        }
        const selected = list.find((s) => s.id === selectedId) ?? list[0]!;
        return (
          <Stack gap={16}>
            <Card>
              <Text variant="label">Scenario</Text>
              <Row wrap gap={8} accessibilityRole="radiogroup" accessibilityLabel="Scenario">
                {list.map((s) => (
                  <Chip key={s.id} label={s.name} selected={s.id === selected.id} onPress={() => setSelectedId(s.id)} testID={`pick-${s.id}`} />
                ))}
              </Row>
              <Row wrap gap={6}>
                <Pill text={`Preset: ${selected.preset}`} icon="options-outline" />
                <Pill text={selected.active_version ? `v${selected.active_version.number}` : 'no version'} icon="layers-outline" />
                {selected.latest_run ? <Pill text={`Run ${selected.latest_run.status}`} icon="analytics-outline" /> : null}
              </Row>
              <Row wrap gap={8}>
                <Button
                  compact
                  variant="secondary"
                  label="Edit inputs"
                  icon="create-outline"
                  onPress={() => router.push({ pathname: '/scenarios/[id]', params: { id: selected.id, focus } })}
                />
                {selected.active_version ? (
                  <MutationButton
                    compact
                    label={selected.latest_run ? 'Run again' : 'Run'}
                    icon="play"
                    loading={run.isPending}
                    onPress={() => run.mutate(selected.active_version?.id ?? '')}
                    testID="planner-run"
                  />
                ) : null}
              </Row>
              <FormError error={run.error} />
            </Card>
            {children(selected)}
          </Stack>
        );
      }}
    </QueryView>
  );
}
