'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { GOAL_TYPES, goalCreateSchema, type Goal } from '@wealthpilot/contracts';
import { GOAL_ICONS, GOAL_LABELS, addMonths, analytics, parseMoneyInput, todayIso } from '@wealthpilot/shared';
import { Check, Trash2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { FormError, PageHeader, QueryView } from '@/components/app';
import { ChoiceField, DateField, MoneyField, TextField } from '@/components/form';
import { GoalProgress } from '@/components/finance/finance';
import { CatalogIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertDialog } from '@/components/ui/dialog';
import { useApiMutation, useGoal, useScenarios } from '@/lib/hooks';
import { qk } from '@/lib/query';

export const goalFormSchema = z.object({
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

/** S13 goal create. */
export function NewGoalPage() {
  return <GoalEditor />;
}

/** S13 goal edit. */
export function EditGoalPage() {
  const params = useParams<{ id: string }>();
  const goal = useGoal(params?.id);
  return <QueryView query={goal}>{(g) => <GoalEditor key={g.id} goal={g} />}</QueryView>;
}

function GoalEditor({ goal }: { goal?: Goal }) {
  const router = useRouter();
  const scenarios = useScenarios();
  const [baseVersion] = useState(goal?.version ?? 0);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  const currency = useWatch({ control, name: 'currency' });
  const inv = [qk.goals, qk.goalAll, qk.scenariosAll];
  const create = useApiMutation((api, f: GoalForm) => api.goals.create(toBody(f)), {
    invalidate: inv,
    onSuccess: (g) => {
      analytics.track('goal_created');
      router.replace(`/goals/${g.id}`);
    },
  });
  const update = useApiMutation(
    // No non-null assertions in callbacks: the React Compiler hoists `goal!.id` into render, which crashes on create.
    (api, f: GoalForm) => api.goals.update(requireGoal(goal).id, { ...toBody(f), version: baseVersion }),
    { invalidate: inv, onSuccess: () => router.push('/goals'), conflict: { entity: 'this goal', onReload: () => router.refresh() } },
  );
  const remove = useApiMutation((api) => api.goals.remove(requireGoal(goal).id), { invalidate: inv, onSuccess: () => router.push('/goals') });
  const mutation = goal ? update : create;

  return (
    <form data-testid="goal-form" noValidate onSubmit={handleSubmit((f) => mutation.mutate(f))}>
      <PageHeader
        title={goal ? 'Edit goal' : 'New goal'}
        back={{ href: '/goals', label: 'Goals' }}
        actions={
          goal ? (
            <Button variant="outline" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden /> Delete goal
            </Button>
          ) : null
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardContent className="gap-4">
            <ChoiceField control={control} name="type" label="Type" options={GOAL_TYPES.map((t) => ({ value: t, label: GOAL_LABELS[t] }))} />
            <TextField control={control} name="name" label="Name" />
            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>
            <MoneyField control={control} name="target_amount" label="Target amount" currency={currency} />
            <ChoiceField control={control} name="priority" label="Priority (1 = highest)" options={['1', '2', '3', '4', '5'].map((p) => ({ value: p, label: p }))} />
            <ChoiceField
              control={control}
              name="scenario_id"
              label="Linked scenario (optional)"
              variant="select"
              helper="When linked, progress uses that scenario’s latest run (illustrative)."
              options={[{ value: '', label: 'None' }, ...(scenarios.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))]}
            />
            <FormError error={mutation.error ?? remove.error} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={mutation.isPending} data-testid="save-goal">
                <Check aria-hidden /> {goal ? 'Save goal' : 'Create goal'}
              </Button>
              <Button variant="ghost" onClick={() => router.push('/goals')}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
        {goal?.progress ? (
          <Card className="h-fit">
            <CardContent>
              <GoalProgress
                name={goal.name}
                icon={<CatalogIcon name={GOAL_ICONS[goal.type]} className="size-4" />}
                pct={goal.progress.pct}
                funded={goal.progress.funded_amount}
                target={goal.target_amount}
                currency={goal.currency}
                targetDate={goal.target_date}
                illustrative={!!goal.progress.scenario_run_id}
              />
              {goal.progress.scenario_run_id ? <p className="text-xs text-muted-foreground">* Illustrative, from the linked scenario’s latest run.</p> : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this goal?"
        description="The goal and its progress tracking are removed. Scenarios are kept."
        actions={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDelete(false);
                remove.mutate();
              }}>
              Delete goal
            </Button>
          </>
        }
      />
    </form>
  );
}
