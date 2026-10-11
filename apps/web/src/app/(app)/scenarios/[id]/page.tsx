import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingState } from '@/components/app';
import { ScenarioEditorPage } from '@/features/scenarios/ScenarioEditorPage';

export const metadata: Metadata = { title: 'Scenario' };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ScenarioEditorPage />
    </Suspense>
  );
}
