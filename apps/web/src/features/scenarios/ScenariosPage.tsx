'use client';

import type { Scenario } from '@wealthpilot/contracts';
import { PRESET_LABELS, SCENARIO_KIND_LABELS, formatDate } from '@wealthpilot/shared';
import { AlertCircle, Archive, CheckCircle2, Circle, GitBranch, GitCompareArrows, Home, Hourglass, Plus, Sunset } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { SwitchRow } from '@/components/form';
import { EmptyState, PageHeader, QueryView } from '@/components/app';
import { Pill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useScenarios } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/** Scenario library with selection for comparison (≤ 4 completed runs). */
export function ScenariosPage() {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const scenarios = useScenarios(showArchived);
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (runId: string) =>
    setSelected((s) => (s.includes(runId) ? s.filter((x) => x !== runId) : s.length >= 4 ? s : [...s, runId]));

  return (
    <div data-testid="scenarios-screen" className="flex flex-col gap-5">
      <PageHeader
        title="Scenarios"
        description="Versioned, reproducible assumption sets. Run one to see illustrative projections; select up to four completed runs to compare."
        actions={
          <>
            <Button
              variant="outline"
              disabled={selected.length < 2}
              onClick={() => router.push(`/scenarios/compare?runs=${selected.join(',')}`)}
              data-testid="compare-selected"
              title="Select at least two scenarios with completed runs">
              <GitCompareArrows aria-hidden /> Compare {selected.length ? `${selected.length} ` : ''}selected
            </Button>
            <Button asChild data-testid="new-scenario">
              <Link href="/scenarios/new">
                <Plus aria-hidden /> New scenario
              </Link>
            </Button>
          </>
        }
      />
      <QueryView query={scenarios}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              icon={GitBranch}
              title="No scenarios yet"
              body="Start from baseline, conservative or optimistic presets, then edit any assumption."
              action={
                <Button asChild>
                  <Link href="/scenarios/new">
                    <Plus aria-hidden /> New scenario
                  </Link>
                </Button>
              }
            />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="scenario-list">
              {data.items.map((s) => (
                <ScenarioCard key={s.id} scenario={s} selected={!!s.latest_run && selected.includes(s.latest_run.id)} onToggle={toggle} />
              ))}
            </ul>
          )
        }
      </QueryView>
      <Card className="w-fit">
        <CardContent className="py-2">
          <SwitchRow label="Show archived scenarios" checked={showArchived} onCheckedChange={setShowArchived} />
        </CardContent>
      </Card>
    </div>
  );
}

function ScenarioCard({ scenario: s, selected, onToggle }: { scenario: Scenario; selected: boolean; onToggle: (runId: string) => void }) {
  const run = s.latest_run;
  const Icon = s.kind === 'home' ? Home : s.kind === 'retirement' ? Sunset : GitBranch;
  return (
    <li className={cn('flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-card', selected && 'border-primary ring-1 ring-primary')}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-link">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <Link href={`/scenarios/${s.id}`} className="font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring" data-testid={`scenario-${s.id}`}>
            {s.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {SCENARIO_KIND_LABELS[s.kind]} · {PRESET_LABELS[s.preset] ?? s.preset} · v{s.active_version?.number ?? '—'} · updated {formatDate(s.updated_at.slice(0, 10))}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {s.archived ? <Pill icon={<Archive aria-hidden />}>Archived</Pill> : null}
        {run ? (
          <Pill
            kind={run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'danger' : 'neutral'}
            icon={run.status === 'completed' ? <CheckCircle2 aria-hidden /> : run.status === 'failed' ? <AlertCircle aria-hidden /> : <Hourglass aria-hidden />}>
            Run {run.status}
          </Pill>
        ) : (
          <Pill icon={<Circle aria-hidden />}>Not run yet</Pill>
        )}
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        {run?.status === 'completed' ? (
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/runs/${run.id}?scenario=${s.id}`}>View results</Link>
            </Button>
            <Button variant={selected ? 'default' : 'outline'} size="sm" aria-pressed={selected} onClick={() => onToggle(run.id)} data-testid={`select-${s.id}`}>
              {selected ? 'Selected to compare' : 'Select to compare'}
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}
