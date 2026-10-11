import type { Metadata } from 'next';

import { EditGoalPage } from '@/features/goals/GoalFormPage';

export const metadata: Metadata = { title: 'Goal' };

export default function Page() {
  return <EditGoalPage />;
}
