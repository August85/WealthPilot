import type { Metadata } from 'next';

import { NewGoalPage } from '@/features/goals/GoalFormPage';

export const metadata: Metadata = { title: 'New goal' };

export default function Page() {
  return <NewGoalPage />;
}
