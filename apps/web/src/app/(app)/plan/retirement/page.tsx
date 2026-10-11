import type { Metadata } from 'next';

import { RetirementPlannerPage } from '@/features/plan/RetirementPlannerPage';

export const metadata: Metadata = { title: 'Retirement planner' };

export default function Page() {
  return <RetirementPlannerPage />;
}
