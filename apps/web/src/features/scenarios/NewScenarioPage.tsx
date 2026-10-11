'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { SCENARIO_KINDS, SCENARIO_PRESETS, scenarioCreateSchema } from '@wealthpilot/contracts';
import { PRESET_HELP, PRESET_LABELS, SCENARIO_KIND_LABELS, analytics } from '@wealthpilot/shared';
import { Check, Info } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { FormError, PageHeader } from '@/components/app';
import { ChoiceField, TextField } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useApiMutation, useGoals } from '@/lib/hooks';
import { qk } from '@/lib/query';

const formSchema = scenarioCreateSchema.omit({ assumptions: true, goal_id: true }).extend({ goal_id: z.string() });
type Form = z.infer<typeof formSchema>;

/** Create a scenario from a preset (S16 entry). The server creates version 1 from /scenarios/defaults. */
export function NewScenarioPage() {
  const router = useRouter();
  const search = useSearchParams();
  const kindParam = search?.get('kind') ?? '';
  const goals = useGoals();
  const initialKind = (SCENARIO_KINDS as readonly string[]).includes(kindParam) ? (kindParam as Form['kind']) : 'home';
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
    <form data-testid="new-scenario" noValidate onSubmit={handleSubmit((f) => create.mutate(f))} className="max-w-2xl">
      <PageHeader title="New scenario" back={{ href: '/scenarios', label: 'Scenarios' }} description="Version 1 is created from the preset applied to your current data." />
      <Card>
        <CardContent className="gap-5">
          <TextField control={control} name="name" label="Name" />
          <ChoiceField control={control} name="kind" label="Kind" options={SCENARIO_KINDS.map((k) => ({ value: k, label: SCENARIO_KIND_LABELS[k] }))} />
          <ChoiceField control={control} name="preset" label="Preset" options={SCENARIO_PRESETS.map((p) => ({ value: p, label: PRESET_LABELS[p] ?? p }))} />
          <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft p-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            {PRESET_HELP[preset]}
          </p>
          <ChoiceField
            control={control}
            name="goal_id"
            label="Link to goal (optional)"
            variant="select"
            options={[{ value: '', label: 'None' }, ...(goals.data?.items ?? []).map((g) => ({ value: g.id, label: g.name }))]}
          />
          <FormError error={create.error} />
          <Button type="submit" loading={create.isPending} className="w-fit" data-testid="create-scenario">
            <Check aria-hidden /> Create scenario
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
