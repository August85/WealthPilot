import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { SCENARIO_PRESETS, type Scenario, type ScenarioAssumptions, type ScenarioPreset, type ScenarioVersion } from '@wealthpilot/contracts';

import { FormError, MutationButton, QueryView } from '@/components/app';
import { PlainTextInput, TextField } from '@/components/form';
import { KeyValue, Pill } from '@/components/finance';
import { Button, Card, Chip, Divider, LinkRow, Row, Screen, SectionHeader, Stack, Text } from '@/components/primitives';
import { useApi } from '@/lib/api';
import { analytics } from '@/lib/analytics';
import { formatTimestamp } from '@/lib/dates';
import { errorMessage, useApiMutation, useScenario, useScenarioVersions } from '@/lib/hooks';
import { qk } from '@/lib/query';

import { AssumptionsEditor } from './AssumptionsEditor';
import { assumptionsToForm, fieldLabel, formToAssumptions, validateAssumptions, type AssumptionsForm, type SectionKey } from './assumptionFields';
import { PRESET_HELP } from './NewScenarioScreen';

/** S16 Scenario editor: presets, clone, rename, archive, version history, every assumption, run. */
export default function ScenarioEditorScreen() {
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const scenario = useScenario(id);
  return (
    <Screen testID="scenario-editor">
      <QueryView query={scenario}>
        {(s) => <Editor key={`${s.id}-${s.active_version?.id ?? 'none'}`} scenario={s} focus={focus as SectionKey | undefined} />}
      </QueryView>
    </Screen>
  );
}

function Editor({ scenario: s, focus }: { scenario: Scenario; focus?: SectionKey }) {
  const api = useApi();
  const qc = useQueryClient();
  const versions = useScenarioVersions(s.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(s.name);
  const [cloneName, setCloneName] = useState(`${s.name} (copy)`);
  const [presetError, setPresetError] = useState<unknown>(null);
  const base = s.active_version?.assumptions;
  const [loaded, setLoaded] = useState(!!base);

  const form = useForm<AssumptionsForm>({
    defaultValues: base ? assumptionsToForm(base) : undefined,
  });

  const invalidate = [qk.scenario(s.id), qk.scenarioVersions(s.id), qk.scenariosAll];
  const update = useApiMutation(
    (a, body: { name?: string; archived?: boolean }) => a.scenarios.update(s.id, { ...body, version: s.version }),
    { invalidate, onSuccess: () => setRenaming(false), conflict: { entity: 'this scenario' } },
  );
  const clone = useApiMutation((a, name: string) => a.scenarios.clone(s.id, { name }), {
    invalidate: [qk.scenariosAll],
    onSuccess: (c) => router.replace(`/scenarios/${c.id}`),
  });
  const saveVersion = useApiMutation(
    (a, body: { assumptions: ScenarioAssumptions; notes?: string }) => a.scenarios.createVersion(s.id, body),
    { invalidate },
  );
  const run = useApiMutation((a, versionId: string) => a.runs.create(versionId, { seed: null }), {
    invalidate,
    onSuccess: (r) => {
      analytics.track('scenario_run_requested', { scenario_kind: s.kind });
      router.push({ pathname: '/runs/[id]', params: { id: r.id, scenario: s.id } });
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
        for (const [path, msg] of Object.entries(res.errors)) {
          form.setError(`values.${path}` as never, { message: msg });
        }
        return;
      }
      setErrors({});
      const v = await saveVersion.mutateAsync({ assumptions: res.value, ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) });
      if (andRun) run.mutate(v.id);
    })();

  return (
    <Stack gap={16}>
      <Stack gap={4}>
        {renaming ? (
          <Stack gap={8}>
            <Text variant="label">Scenario name</Text>
            <PlainTextInput label="Scenario name" value={newName} onChangeText={setNewName} />
            <Row gap={8}>
              <MutationButton compact label="Save name" onPress={() => update.mutate({ name: newName.trim() })} disabled={!newName.trim()} />
              <Button compact variant="ghost" label="Cancel" onPress={() => setRenaming(false)} />
            </Row>
          </Stack>
        ) : (
          <Row>
            <Text variant="title" style={{ flex: 1 }}>
              {s.name}
            </Text>
            <Button compact variant="ghost" label="Rename" icon="create-outline" onPress={() => setRenaming(true)} />
          </Row>
        )}
        <Row wrap gap={6}>
          <Pill text={`Preset: ${s.preset}`} icon="options-outline" />
          <Pill text={`Kind: ${s.kind}`} icon="git-branch-outline" />
          <Pill text={s.active_version ? `Active v${s.active_version.number}` : 'No version yet'} icon="layers-outline" kind="accent" />
          {s.archived ? <Pill text="Archived" icon="archive-outline" kind="warn" /> : null}
        </Row>
      </Stack>

      {s.latest_run ? (
        <LinkRow
          icon="analytics-outline"
          title={`Latest run: ${s.latest_run.status}`}
          subtitle={`Started ${formatTimestamp(s.latest_run.created_at)}`}
          onPress={() => router.push({ pathname: '/runs/[id]', params: { id: s.latest_run!.id, scenario: s.id } })}
        />
      ) : null}

      <Card>
        <Text variant="heading">Start from a preset</Text>
        <Text variant="caption" tone="muted">
          Replaces the values below with server defaults for the preset (your data, adjusted). Nothing is saved until you save
          a version.
        </Text>
        <Row wrap gap={8}>
          {SCENARIO_PRESETS.map((p) => (
            <Chip key={p} label={p.charAt(0).toUpperCase() + p.slice(1)} onPress={() => applyPreset(p)} testID={`preset-${p}`} />
          ))}
        </Row>
        <Text variant="caption" tone="muted">
          {SCENARIO_PRESETS.map((p) => `${p}: ${PRESET_HELP[p]}`).join('\n')}
        </Text>
        <FormError error={presetError} />
      </Card>

      {loaded ? (
        <>
          <SectionHeader title="Assumptions" />
          <Text variant="caption" tone="muted">
            Every value is your assumption, not a market fact. Saving creates a new immutable version; past runs keep theirs.
          </Text>
          <AssumptionsEditor control={form.control} initiallyOpen={focus ? [focus] : ['household', 'income']} />
          <TextField control={form.control} name="notes" label="Version notes (optional)" multiline />
          {Object.keys(errors).length ? (
            <Card tone="danger" testID="assumption-errors">
              <Text variant="bodyStrong" tone="danger">
                ⚠ Fix these before saving:
              </Text>
              {Object.entries(errors).map(([k, m]) => (
                <Text key={k} variant="caption">
                  {fieldLabel(k)} — {m}
                </Text>
              ))}
            </Card>
          ) : null}
          <FormError error={saveVersion.error ?? run.error} />
          <MutationButton label="Save version and run" icon="play" onPress={() => submit(true)} loading={saveVersion.isPending || run.isPending} testID="save-and-run" />
          <MutationButton label="Save version only" variant="secondary" onPress={() => submit(false)} />
        </>
      ) : (
        <Card tone="warning">
          <Text>This scenario has no version yet. Pick a preset above to load assumptions.</Text>
        </Card>
      )}

      <Card testID="version-history">
        <Text variant="heading">Version history</Text>
        <QueryView query={versions}>
          {(data) => (
            <Stack gap={8}>
              {data.items.map((v) => (
                <VersionRow key={v.id} version={v} active={v.id === s.active_version?.id} onRun={() => run.mutate(v.id)} onLoad={() => form.reset(assumptionsToForm(v.assumptions))} />
              ))}
            </Stack>
          )}
        </QueryView>
      </Card>

      <Card>
        <Text variant="heading">Clone</Text>
        <PlainTextInput label="Name for the copy" value={cloneName} onChangeText={setCloneName} />
        <MutationButton label="Clone scenario" icon="copy-outline" variant="secondary" onPress={() => clone.mutate(cloneName.trim())} loading={clone.isPending} />
        <FormError error={clone.error} />
      </Card>
      <MutationButton
        label={s.archived ? 'Unarchive scenario' : 'Archive scenario'}
        variant="secondary"
        icon="archive-outline"
        onPress={() => update.mutate({ archived: !s.archived })}
      />
      {update.error ? <Text tone="danger">{errorMessage(update.error)}</Text> : null}
    </Stack>
  );
}

function VersionRow({
  version: v,
  active,
  onRun,
  onLoad,
}: {
  version: ScenarioVersion;
  active: boolean;
  onRun: () => void;
  onLoad: () => void;
}) {
  return (
    <Stack gap={4}>
      <Row wrap gap={6}>
        <Text variant="bodyStrong">Version {v.number}</Text>
        {active ? <Pill text="Active" kind="ok" icon="checkmark-circle" /> : null}
      </Row>
      <Text variant="caption" tone="muted">
        {formatTimestamp(v.created_at)} · model {v.model_version} · rules {v.rulepack_version}
      </Text>
      <KeyValue label="Input hash">{v.input_hash.replace(/^sha256:/, '').slice(0, 16)}</KeyValue>
      {v.notes ? (
        <Text variant="caption" tone="muted">
          “{v.notes}”
        </Text>
      ) : null}
      <Row gap={8}>
        <MutationButton compact variant="ghost" label="Run" icon="play-outline" onPress={onRun} />
        <Button compact variant="ghost" label="Load into editor" icon="download-outline" onPress={onLoad} />
      </Row>
      <Divider />
    </Stack>
  );
}
