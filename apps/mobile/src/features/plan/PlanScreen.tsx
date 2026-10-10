import { router } from 'expo-router';
import { useState } from 'react';

import type { Scenario } from '@wealthpilot/contracts';

import { QueryView } from '@/components/app';
import { SwitchRow } from '@/components/form';
import { GoalProgress, Pill } from '@/components/finance';
import { Button, Card, Chip, EmptyState, LinkRow, Row, Screen, SectionHeader, Stack, Text } from '@/components/primitives';
import { GOAL_ICONS } from '@/lib/catalog';
import { formatDate } from '@/lib/dates';
import { useGoals, useScenarios } from '@/lib/hooks';

const PRESET_LABEL: Record<string, string> = {
  baseline: 'Baseline',
  conservative: 'Conservative',
  optimistic: 'Optimistic',
  custom: 'Custom',
};

/** Plan tab: S13 goal list, planners, scenario library and comparison entry point. */
export default function PlanScreen() {
  const goals = useGoals();
  const [showArchived, setShowArchived] = useState(false);
  const scenarios = useScenarios(showArchived);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (runId: string) =>
    setSelected((s) => (s.includes(runId) ? s.filter((x) => x !== runId) : s.length >= 4 ? s : [...s, runId]));

  return (
    <Screen testID="plan-screen">
      <SectionHeader
        title="Goals"
        action={<Button compact label="New goal" icon="add" onPress={() => router.push('/goals/new')} testID="new-goal" />}
      />
      <QueryView query={goals}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              icon="flag-outline"
              title="Create your first goal"
              body="A home purchase, retirement, education or emergency fund."
              actionLabel="New goal"
              onAction={() => router.push('/goals/new')}
            />
          ) : (
            <Card testID="goal-list">
              {data.items.map((g) => (
                <GoalProgress
                  key={g.id}
                  name={g.name}
                  icon={GOAL_ICONS[g.type]}
                  pct={g.progress?.pct}
                  funded={g.progress?.funded_amount}
                  target={g.target_amount}
                  currency={g.currency}
                  targetDate={g.target_date}
                  illustrative={!!g.progress?.scenario_run_id}
                  onPress={() => router.push(`/goals/${g.id}`)}
                />
              ))}
              <Text variant="caption" tone="muted">
                Funded amounts use goal-eligible funds only (or the linked scenario’s latest run, marked *). Illustrative.
              </Text>
            </Card>
          )
        }
      </QueryView>

      <SectionHeader title="Planners" />
      <Card>
        <LinkRow icon="home-outline" title="Home planner" subtitle="Down payment, P&I vs all-in cost, funding timeline" onPress={() => router.push('/plan/home')} />
        <LinkRow icon="sunny-outline" title="Retirement planner" subtitle="Cash flows, balances, deficit years" onPress={() => router.push('/plan/retirement')} />
        <LinkRow icon="swap-horizontal" title="FX assumptions" subtitle="Your USD/INR planning rate" onPress={() => router.push('/fx')} />
      </Card>

      <SectionHeader
        title="Scenarios"
        action={<Button compact label="New" icon="add" onPress={() => router.push('/scenarios/new')} testID="new-scenario" />}
      />
      <QueryView query={scenarios}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              icon="git-branch-outline"
              title="No scenarios yet"
              body="Start from baseline, conservative or optimistic presets, then edit any assumption."
              actionLabel="New scenario"
              onAction={() => router.push('/scenarios/new')}
            />
          ) : (
            <Card testID="scenario-list">
              {data.items.map((s) => (
                <ScenarioRow key={s.id} scenario={s} selected={!!s.latest_run && selected.includes(s.latest_run.id)} onToggle={toggle} />
              ))}
            </Card>
          )
        }
      </QueryView>
      <SwitchRow label="Show archived scenarios" value={showArchived} onValueChange={setShowArchived} />
      <Button
        label={`Compare ${selected.length || ''} selected run${selected.length === 1 ? '' : 's'} (max 4)`}
        icon="git-compare-outline"
        disabled={selected.length < 2}
        onPress={() => router.push({ pathname: '/scenarios/compare', params: { runs: selected.join(',') } })}
        testID="compare-selected"
        accessibilityHint="Select at least two scenarios with completed runs"
      />
    </Screen>
  );
}

function ScenarioRow({
  scenario: s,
  selected,
  onToggle,
}: {
  scenario: Scenario;
  selected: boolean;
  onToggle: (runId: string) => void;
}) {
  const run = s.latest_run;
  return (
    <Stack gap={4}>
      <LinkRow
        icon={s.kind === 'home' ? 'home-outline' : s.kind === 'retirement' ? 'sunny-outline' : 'git-branch-outline'}
        title={s.name}
        subtitle={`${PRESET_LABEL[s.preset] ?? s.preset} · v${s.active_version?.number ?? '—'} · updated ${formatDate(s.updated_at.slice(0, 10))}`}
        onPress={() => router.push(`/scenarios/${s.id}`)}
      />
      <Row wrap gap={6}>
        {s.archived ? <Pill text="Archived" icon="archive-outline" /> : null}
        {run ? (
          <Pill
            text={`Run ${run.status}`}
            icon={run.status === 'completed' ? 'checkmark-circle' : run.status === 'failed' ? 'alert-circle' : 'hourglass-outline'}
            kind={run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'danger' : 'neutral'}
          />
        ) : (
          <Pill text="Not run yet" icon="ellipse-outline" />
        )}
        {run?.status === 'completed' ? (
          <Chip
            label={selected ? 'Selected to compare' : 'Select to compare'}
            selected={selected}
            onPress={() => onToggle(run.id)}
            testID={`select-${s.id}`}
          />
        ) : null}
      </Row>
    </Stack>
  );
}
