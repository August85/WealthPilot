import type { Metadata } from 'next';

import { HomePlannerPage } from '@/features/plan/HomePlannerPage';

export const metadata: Metadata = { title: 'Home planner' };

export default function Page() {
  return <HomePlannerPage />;
}
