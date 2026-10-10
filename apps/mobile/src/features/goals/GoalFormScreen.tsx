import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { GOAL_TYPES, goalCreateSchema, type Goal } from '@wealthpilot/contracts';

import { FormError, MutationButton, QueryView } from '@/components/app';
import { ChoiceField, DateField, MoneyField, TextField } from '@/components/form';
import { GoalProgress } from '@/components/finance';
import { Button, Card, Screen, Stack, Text } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import { GOAL_ICONS, GOAL_LABELS } from '@/lib/catalog';
import { addMonths, todayIso } from '@/lib/dates';
import { useApiMutation, useGoal, useScenarios } from '@/lib/hooks';
import { parseMoneyInput } from '@/lib/money';
import { qk } from '@/lib/query';

const goalFormSchema = z.object({
  type: z.enum(GOAL_TYPES),
  name: z.string().trim().min(1, 'Name the goal').max(100),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  target_amount: z.string().refine((v) => parseMoneyInput(v) !== null && !v.includes('-'), 'Enter an amount'),
  currency: z.enum(['USD', 'INR']),
  priority: z.enum(['1', '2', '3', '4', '5']),
  scenario_id: z.string(),
});
type GoalForm = z.infer<typeof goalFormSchema>;

function toBody(f: GoalForm) {
  return goalCreateSchema.parse({
    type: f.type,
    name: f.name.trim(),
    target_date: f.target_date,
    target_amount: parseMoneyInput(f.target_amount),
    currency: f.currency,
    priority: Number(f.priority),
    scenario_id: f.scenario_id || null,
  });
}

function requireGoal(goal: Goal | undefined): Goal {
  if (!goal) throw new Error('No goal loaded');
  return goal;
}

/** S13 goal create/edit. */
export default function GoalFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const goal = useGoal(id);
  if (!id) return <GoalEditor />;
  return (
    <Screen>
      <QueryView query={goal}>{(g) => <GoalEditor key={`${g.id}-${g.version}`} goal={g} />}</QueryView>
    </Screen>
  );
}

function GoalEditor({ goal }: { goal?: Goal }) {
  const scenarios = useScenarios();
  const { control, handleSubmit } = useForm<GoalForm>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: goal
      ? {
          type: goal.type,
          name: goal.name,
          target_date: goal.target_date,
          target_amount: goal.target_amount,
          currency: goal.currency === 'INR' ? 'INR' : 'USD',
          priority: String(goal.priority) as GoalForm['priority'],
          scenario_id: goal.scenario_id ?? '',
        }
      : {
          type: 'home_purchase',
          name: 'Home',
          target_date: addMonths(todayIso(), 48),
          target_amount: '',
          currency: 'USD',
          priority: '1',
          scenario_id: '',
        },
  });
  const inv = [qk.goals, ['goal'], qk.scenariosAll];
  const create = useApiMutation((api, f: GoalForm) => api.goals.create(toBody(f)), {
    invalidate: inv,
    onSuccess: (g) => {
      analytics.track('goal_created');
      router.replace(`/goals/${g.id}`);
    },
  });
  const update = useApiMutation(
    // No non-null assertions in callbacks: the React Compiler hoists `goal!.id` into render, which crashes on create.
    (api, f: GoalForm) => api.goals.update(requireGoal(goal).id, { ...toBody(f), version: requireGoal(goal).version }),
    { invalidate: inv, onSuccess: () => router.back(), conflict: { entity: 'this goal' } },
  );
  const remove = useApiMutation((api) => api.goals.remove(requireGoal(goal).id), { invalidate: inv, onSuccess: () => router.back() });
  const mutation = goal ? update : create;

  const body = (
    <Stack gap={14}>
      <Text variant="title">{goal ? 'Edit goal' : 'New goal'}</Text>
      {goal?.progress ? (
        <Card>
          <GoalProgress
            name={goal.name}
            icon={GOAL_ICONS[goal.type]}
            pct={goal.progress.pct}
            funded={goal.progress.funded_amount}
            target={goal.target_amount}
            currency={goal.currency}
            targetDate={goal.target_date}
            illustrative={!!goal.progress.scenario_run_id}
          />
        </Card>
      ) : null}
      <ChoiceField control={control} name="type" label="Type" options={GOAL_TYPES.map((t) => ({ value: t, label: GOAL_LABELS[t] }))} />
      <TextField control={control} name="name" label="Name" />
      <DateField control={control} name="target_date" label="Target date" />
      <ChoiceField
        control={control}
        name="currency"
        label="Currency"
        options={[
          { value: 'USD', label: '$ USD' },
          { value: 'INR', label: '₹ INR' },
        ]}
      />
      <MoneyField control={control} name="target_amount" label="Target amount" />
      <ChoiceField
        control={control}
        name="priority"
        label="Priority (1 = highest)"
        options={['1', '2', '3', '4', '5'].map((p) => ({ value: p, label: p }))}
      />
      <ChoiceField
        control={control}
        name="scenario_id"
        label="Linked scenario (optional)"
        helper="When linked, progress uses that scenario’s latest run (illustrative)."
        options={[{ value: '', label: 'None' }, ...(scenarios.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))]}
      />
      <FormError error={mutation.error ?? remove.error} />
      <MutationButton
        label={goal ? 'Save goal' : 'Create goal'}
        icon="checkmark"
        loading={mutation.isPending}
        onPress={handleSubmit((f) => mutation.mutate(f))}
        testID="save-goal"
      />
      {goal ? <MutationButton label="Delete goal" variant="danger" icon="trash-outline" onPress={() => remove.mutate()} /> : null}
      <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
    </Stack>
  );
  return goal ? body : <Screen testID="goal-form">{body}</Screen>;
}
