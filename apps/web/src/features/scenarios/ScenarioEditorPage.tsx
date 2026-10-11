'use client';

import { useQueryClient } from '@tanstack/react-query';
import { SCENARIO_PRESETS, type Scenario, type ScenarioAssumptions, type ScenarioPreset, type ScenarioVersion } from '@wealthpilot/contracts';
import {
  PRESET_HELP,
  PRESET_LABELS,
  SCENARIO_KIND_LABELS,
  analytics,
  assumptionsToForm,
  fieldLabel,
  formToAssumptions,
  formatTimestamp,
  validateAssumptions,
  type AssumptionsForm,
  type SectionKey,
} from '@wealthpilot/shared';
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  BarChart3,
  CheckCircle2,
  Copy,
  Download,
  GitBranch,
  Layers,
  Pencil,
  Play,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { FormError, LinkRow, PageHeader, QueryView } from '@/components/app';
import { PlainInput, TextField } from '@/components/form';
import { Pill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/lib/api';
import { useApiMutation, useScenario, useScenarioVersions } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { cn } from '@/lib/utils';

import { AssumptionsEditor } from './AssumptionsEditor';

/** S16 Scenario editor: presets, clone, rename, archive, version history, every assumption, run. */
export function ScenarioEditorPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const focus = (search?.get('focus') ?? undefined) as SectionKey | undefined;
  const scenario = useScenario(params?.id);
  return (
    <div data-testid="scenario-editor">
      <QueryView query={scenario}>{(s) => <Editor key={`${s.id}-${s.active_version?.id ?? 'none'}`} scenario={s} focus={focus} />}</QueryView>
    </div>
  );
}

function Editor({ scenario: s, focus }: { scenario: Scenario; focus?: SectionKey }) {
  const api = useApi();
  const qc = useQueryClient();
  const router = useRouter();
  const versions = useScenarioVersions(s.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(s.name);
  const [cloneName, setCloneName] = useState(`${s.name} (copy)`);
  const [presetError, setPresetError] = useState<unknown>(null);
  // Scenario metadata version this page is editing. Follows our own successful writes, never background refetches.
  const [baseVersion, setBaseVersion] = useState(s.version);
  const base = s.active_version?.assumptions;
  const [loaded, setLoaded] = useState(!!base);

  const form = useForm<AssumptionsForm>({ defaultValues: base ? assumptionsToForm(base) : undefined });

  const invalidate = [qk.scenario(s.id), qk.scenarioVersions(s.id), qk.scenariosAll];
  const update = useApiMutation((a, body: { name?: string; archived?: boolean }) => a.scenarios.update(s.id, { ...body, version: baseVersion }), {
    invalidate,
    onSuccess: (updated) => {
      setBaseVersion(updated.version);
      setRenaming(false);
    },
    conflict: { entity: 'this scenario', onReload: () => setBaseVersion(s.version) },
  });
  const clone = useApiMutation((a, name: string) => a.scenarios.clone(s.id, { name }), {
    invalidate: [qk.scenariosAll],
    onSuccess: (c) => router.push(`/scenarios/${c.id}`),
  });
  const saveVersion = useApiMutation((a, body: { assumptions: ScenarioAssumptions; notes?: string }) => a.scenarios.createVersion(s.id, body), {
    invalidate,
  });
  const run = useApiMutation((a, versionId: string) => a.runs.create(versionId, { seed: null }), {
    invalidate: [...invalidate, qk.goals],
    onSuccess: (r) => {
      analytics.track('scenario_run_requested', { scenario_kind: s.kind });
      router.push(`/runs/${r.id}?scenario=${s.id}`);
    },
  });

  const applyPreset = async (preset: ScenarioPreset) => {
    setPresetError(null);
    try {
      const d = await qc.fetchQuery({
        queryKey: qk.scenarioDefaults(preset, s.kind),
        queryFn: () => api.scenarios.defaults({ preset, kind: s.kind }),
      });
      form.reset(assumptionsToForm(d, form.getValues('notes') ?? ''));
      setLoaded(true);
    } catch (e) {
      setPresetError(e);
    }
  };

  const submit = (andRun: boolean) =>
    form.handleSubmit(async (f) => {
      const raw = formToAssumptions(f, base);
      const res = validateAssumptions(raw);
      if (!res.ok) {
        setErrors(res.errors);
        for (const [path, msg] of Object.entries(res.errors)) form.setError(`values.${path}` as never, { message: msg });
        return;
      }
      setErrors({});
      try {
        const v = await saveVersion.mutateAsync({ assumptions: res.value, ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) });
        if (andRun) run.mutate(v.id);
      } catch {
        // surfaced through saveVersion.error
      }
    })();

  return (
    <>
      <PageHeader
        title={s.name}
        back={{ href: '/scenarios', label: 'Scenarios' }}
        eyebrow={
          <div className="flex flex-wrap gap-1.5">
            <Pill icon={<SlidersHorizontal aria-hidden />}>Preset: {PRESET_LABELS[s.preset] ?? s.preset}</Pill>
            <Pill icon={<GitBranch aria-hidden />}>{SCENARIO_KIND_LABELS[s.kind]}</Pill>
            <Pill kind="accent" icon={<Layers aria-hidden />}>
              {s.active_version ? `Active v${s.active_version.number}` : 'No version yet'}
            </Pill>
            {s.archived ? (
              <Pill kind="warn" icon={<Archive aria-hidden />}>
                Archived
              </Pill>
            ) : null}
          </div>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setRenaming((r) => !r)} data-testid="rename-scenario">
              <Pencil aria-hidden /> Rename
            </Button>
            <Button variant="outline" onClick={() => update.mutate({ archived: !s.archived })} data-testid="archive-scenario">
              {s.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              {s.archived ? 'Unarchive' : 'Archive'}
            </Button>
          </>
        }
      />
      {renaming ? (
        <Card className="mb-5">
          <CardContent className="gap-3">
            <label htmlFor="scenario-name" className="text-sm font-medium">
              Scenario name
            </label>
            <PlainInput id="scenario-name" value={newName} onChange={setNewName} testId="scenario-name" />
            <div className="flex gap-2">
              <Button size="sm" disabled={!newName.trim()} loading={update.isPending} onClick={() => update.mutate({ name: newName.trim() })}>
                Save name
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      <FormError error={update.error} className="mb-5" />

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          {loaded ? (
            <>
              <div>
                <h2 className="text-lg font-semibold">Assumptions</h2>
                <p className="text-sm text-muted-foreground">
                  Every value is your assumption, not a market fact. Saving creates a new immutable version; past runs keep theirs.
                </p>
              </div>
              <AssumptionsEditor control={form.control} initiallyOpen={focus ? [focus] : ['household', 'income']} />
              <Card>
                <CardContent className="gap-4">
                  <TextField control={form.control} name="notes" label="Version notes (optional)" multiline />
                  {Object.keys(errors).length ? (
                    <div role="alert" data-testid="assumption-errors" className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm">
                      <p className="flex items-center gap-1.5 font-semibold text-danger">
                        <AlertCircle className="size-4" aria-hidden /> Fix these before saving:
                      </p>
                      <ul className="mt-1 list-disc pl-5">
                        {Object.entries(errors).map(([k, m]) => (
                          <li key={k}>
                            {fieldLabel(k)} — {m}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <FormError error={saveVersion.error ?? run.error} />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => submit(true)} loading={saveVersion.isPending || run.isPending} data-testid="save-and-run">
                      <Play aria-hidden /> Save version and run
                    </Button>
                    <Button variant="outline" onClick={() => submit(false)} disabled={saveVersion.isPending} data-testid="save-version">
                      <Save aria-hidden /> Save version only
                    </Button>
                  </div>
                  {saveVersion.isSuccess && !run.isPending ? (
                    <p role="status" className="flex items-center gap-1.5 text-sm text-success">
                      <CheckCircle2 className="size-4" aria-hidden /> Saved as version {saveVersion.data.number}.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card tone="warning">
              <CardContent>This scenario has no version yet. Pick a preset to load assumptions.</CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {s.latest_run ? (
            <Card>
              <CardContent className="py-3">
                <LinkRow
                  href={`/runs/${s.latest_run.id}?scenario=${s.id}`}
                  icon={BarChart3}
                  title={`Latest run: ${s.latest_run.status}`}
                  subtitle={`Started ${formatTimestamp(s.latest_run.created_at)}`}
                  testId="latest-run"
                />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader className="flex-col">
              <CardTitle>Start from a preset</CardTitle>
              <CardDescription>Replaces the values with server defaults for the preset (your data, adjusted). Nothing is saved until you save a version.</CardDescription>
            </CardHeader>
            <CardContent className="gap-3">
              <div className="flex flex-wrap gap-2">
                {SCENARIO_PRESETS.map((p) => (
                  <Button key={p} variant="outline" size="sm" onClick={() => void applyPreset(p)} data-testid={`preset-${p}`}>
                    {PRESET_LABELS[p] ?? p}
                  </Button>
                ))}
              </div>
              <dl className="flex flex-col gap-1 text-xs text-muted-foreground">
                {SCENARIO_PRESETS.map((p) => (
                  <div key={p}>
                    <dt className="inline font-medium text-foreground">{PRESET_LABELS[p] ?? p}: </dt>
                    <dd className="inline">{PRESET_HELP[p]}</dd>
                  </div>
                ))}
              </dl>
              <FormError error={presetError} />
            </CardContent>
          </Card>
          <Card data-testid="version-history">
            <CardHeader>
              <CardTitle>Version history</CardTitle>
            </CardHeader>
            <CardContent>
              <QueryView query={versions} rows={1}>
                {(data) => (
                  <ul className="flex flex-col divide-y">
                    {data.items.map((v) => (
                      <VersionRow
                        key={v.id}
                        version={v}
                        active={v.id === s.active_version?.id}
                        running={run.isPending}
                        onRun={() => run.mutate(v.id)}
                        onLoad={() => {
                          form.reset(assumptionsToForm(v.assumptions));
                          setLoaded(true);
                        }}
                      />
                    ))}
                  </ul>
                )}
              </QueryView>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Clone</CardTitle>
            </CardHeader>
            <CardContent className="gap-3">
              <label htmlFor="clone-name" className="text-sm font-medium">
                Name for the copy
              </label>
              <PlainInput id="clone-name" value={cloneName} onChange={setCloneName} />
              <FormError error={clone.error} />
              <Button variant="outline" className="w-fit" disabled={!cloneName.trim()} loading={clone.isPending} onClick={() => clone.mutate(cloneName.trim())}>
                <Copy aria-hidden /> Clone scenario
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function VersionRow({
  version: v,
  active,
  running,
  onRun,
  onLoad,
}: {
  version: ScenarioVersion;
  active: boolean;
  running: boolean;
  onRun: () => void;
  onLoad: () => void;
}) {
  return (
    <li className={cn('flex flex-col gap-1 py-3')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Version {v.number}</span>
        {active ? (
          <Pill kind="ok" icon={<CheckCircle2 aria-hidden />}>
            Active
          </Pill>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {formatTimestamp(v.created_at)} · model {v.model_version} · rules {v.rulepack_version}
      </p>
      <p className="font-mono text-xs text-muted-foreground" title={v.input_hash}>
        Input hash {v.input_hash.replace(/^sha256:/, '').slice(0, 16)}
      </p>
      {v.notes ? <p className="text-xs text-muted-foreground">“{v.notes}”</p> : null}
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={onRun} disabled={running}>
          <Play aria-hidden /> Run
        </Button>
        <Button variant="ghost" size="sm" onClick={onLoad}>
          <Download aria-hidden /> Load into editor
        </Button>
      </div>
    </li>
  );
}
