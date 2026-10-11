'use client';

import type { Scenario, ScenarioKind } from '@wealthpilot/contracts';
import { PRESET_LABELS, analytics } from '@wealthpilot/shared';
import { BarChart3, Home, Layers, Pencil, Play, Plus, SlidersHorizontal, Sunset } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { ChipGroup } from '@/components/form';
import { EmptyState, FormError, QueryView } from '@/components/app';
import { Pill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useApiMutation, useScenarios } from '@/lib/hooks';
import { qk } from '@/lib/query';

/** Picks the scenario a planner works on (filtered by kind) and offers run / edit actions. */
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
    invalidate: [qk.scenariosAll, qk.scenarioAll, qk.goals],
    onSuccess: () => analytics.track('scenario_run_requested', { scenario_kind: newKind }),
  });

  return (
    <QueryView query={scenarios} loadingLabel="Loading scenarios">
      {(data) => {
        const list = data.items.filter((s) => kinds.includes(s.kind));
        const selected = list.find((s) => s.id === selectedId) ?? list[0];
        if (!selected) {
          return (
            <EmptyState
              icon={newKind === 'home' ? Home : Sunset}
              title={emptyTitle}
              body="Create a scenario from a preset. Your accounts, RSUs and FX rate are captured automatically."
              action={
                <Button asChild>
                  <Link href={`/scenarios/new?kind=${newKind}`}>
                    <Plus aria-hidden /> Create scenario
                  </Link>
                </Button>
              }
            />
          );
        }
        const activeVersionId = selected.active_version?.id;
        return (
          <div className="flex flex-col gap-5">
            <Card>
              <CardContent className="gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <ChipGroup
                    ariaLabel="Scenario"
                    value={selected.id}
                    onChange={setSelectedId}
                    options={list.map((s) => ({ value: s.id, label: s.name }))}
                    testIdPrefix="pick"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/scenarios/${selected.id}?focus=${focus}`}>
                        <Pencil aria-hidden /> Edit inputs
                      </Link>
                    </Button>
                    {selected.latest_run?.status === 'completed' ? (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/runs/${selected.latest_run.id}?scenario=${selected.id}`}>
                          <BarChart3 aria-hidden /> Full results
                        </Link>
                      </Button>
                    ) : null}
                    {activeVersionId ? (
                      <Button size="sm" loading={run.isPending} onClick={() => run.mutate(activeVersionId)} data-testid="planner-run">
                        <Play aria-hidden /> {selected.latest_run ? 'Run again' : 'Run'}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Pill icon={<SlidersHorizontal aria-hidden />}>Preset: {PRESET_LABELS[selected.preset] ?? selected.preset}</Pill>
                  <Pill icon={<Layers aria-hidden />}>{selected.active_version ? `v${selected.active_version.number}` : 'no version'}</Pill>
                  {selected.latest_run ? <Pill icon={<BarChart3 aria-hidden />}>Run {selected.latest_run.status}</Pill> : null}
                </div>
                <FormError error={run.error} />
              </CardContent>
            </Card>
            {children(selected)}
          </div>
        );
      }}
    </QueryView>
  );
}
