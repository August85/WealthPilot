import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useForm, useWatch } from 'react-hook-form';

import { SCENARIO_KINDS, SCENARIO_PRESETS, scenarioCreateSchema } from '@wealthpilot/contracts';
import { PRESET_HELP, SCENARIO_KIND_LABELS } from '@wealthpilot/shared';

import { FormError, MutationButton } from '@/components/app';
import { ChoiceField, TextField } from '@/components/form';
import { Card, Screen, Text } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import { useApiMutation, useGoals } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { z } from 'zod';

const KIND_LABELS = SCENARIO_KIND_LABELS;
export { PRESET_HELP };

const formSchema = scenarioCreateSchema.omit({ assumptions: true, goal_id: true }).extend({ goal_id: z.string() });
type Form = z.infer<typeof formSchema>;

/** Create a scenario from a preset (S16 entry). The server creates version 1 from /scenarios/defaults. */
export default function NewScenarioScreen() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const goals = useGoals();
  const initialKind = (SCENARIO_KINDS as readonly string[]).includes(params.kind ?? '') ? (params.kind as Form['kind']) : 'home';
  const { control, handleSubmit } = useForm<Form>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: 'Baseline', kind: initialKind, preset: 'baseline', goal_id: '' },
  });
  const preset = useWatch({ control, name: 'preset' });
  const create = useApiMutation((api, f: Form) => api.scenarios.create({ ...f, goal_id: f.goal_id || null }), {
    invalidate: [qk.scenariosAll],
    onSuccess: (s) => {
      analytics.track('scenario_created', { scenario_kind: s.kind, preset: s.preset });
      router.replace(`/scenarios/${s.id}`);
    },
  });
  return (
    <Screen testID="new-scenario">
      <Text variant="title">New scenario</Text>
      <TextField control={control} name="name" label="Name" />
      <ChoiceField control={control} name="kind" label="Kind" options={SCENARIO_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
      <ChoiceField
        control={control}
        name="preset"
        label="Preset"
        options={SCENARIO_PRESETS.map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))}
      />
      <Card tone="info">
        <Text variant="caption">{PRESET_HELP[preset]}</Text>
      </Card>
      <ChoiceField
        control={control}
        name="goal_id"
        label="Link to goal (optional)"
        options={[{ value: '', label: 'None' }, ...(goals.data?.items ?? []).map((g) => ({ value: g.id, label: g.name }))]}
      />
      <FormError error={create.error} />
      <MutationButton label="Create scenario" icon="checkmark" onPress={handleSubmit((f) => create.mutate(f))} loading={create.isPending} />
    </Screen>
  );
}
