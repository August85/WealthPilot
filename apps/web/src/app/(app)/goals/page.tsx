import type { Metadata } from 'next';

import { GoalsPage } from '@/features/goals/GoalsPage';

export const metadata: Metadata = { title: 'Goals' };

export default function Page() {
  return <GoalsPage />;
}
