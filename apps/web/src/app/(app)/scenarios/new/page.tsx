import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingState } from '@/components/app';
import { NewScenarioPage } from '@/features/scenarios/NewScenarioPage';

export const metadata: Metadata = { title: 'New scenario' };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <NewScenarioPage />
    </Suspense>
  );
}
