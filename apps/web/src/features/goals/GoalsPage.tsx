'use client';

import { GOAL_ICONS } from '@wealthpilot/shared';
import { ArrowLeftRight, Flag, Home, Plus, Sunset } from 'lucide-react';
import Link from 'next/link';

import { EmptyState, LinkRow, PageHeader, QueryView } from '@/components/app';
import { GoalProgress } from '@/components/finance/finance';
import { CatalogIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGoals } from '@/lib/hooks';

/** S13 goal list with entry points to the planners. */
export function GoalsPage() {
  const goals = useGoals();
  return (
    <div data-testid="goals-screen">
      <PageHeader
        title="Goals"
        description="Funded amounts use goal-eligible funds only, or the linked scenario’s latest run (marked *, illustrative)."
        actions={
          <Button asChild data-testid="new-goal">
            <Link href="/goals/new">
              <Plus aria-hidden /> New goal
            </Link>
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <QueryView query={goals}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState
                icon={Flag}
                title="Create your first goal"
                body="A home purchase, retirement, education or emergency fund."
                action={
                  <Button asChild>
                    <Link href="/goals/new">
                      <Plus aria-hidden /> New goal
                    </Link>
                  </Button>
                }
              />
            ) : (
              <Card data-testid="goal-list">
                <CardContent className="gap-2">
                  {data.items.map((g) => (
                    <GoalProgress
                      key={g.id}
                      name={g.name}
                      icon={<CatalogIcon name={GOAL_ICONS[g.type]} className="size-4" />}
                      pct={g.progress?.pct}
                      funded={g.progress?.funded_amount}
                      target={g.target_amount}
                      currency={g.currency}
                      targetDate={g.target_date}
                      illustrative={!!g.progress?.scenario_run_id}
                      href={`/goals/${g.id}`}
                    />
                  ))}
                </CardContent>
              </Card>
            )
          }
        </QueryView>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Planners</CardTitle>
          </CardHeader>
          <CardContent className="gap-1">
            <LinkRow href="/plan/home" icon={Home} title="Home planner" subtitle="Down payment, P&I vs all-in cost, funding timeline" />
            <LinkRow href="/plan/retirement" icon={Sunset} title="Retirement planner" subtitle="Cash flows, balances, deficit years" />
            <LinkRow href="/fx" icon={ArrowLeftRight} title="FX assumptions" subtitle="Your USD/INR planning rate" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
