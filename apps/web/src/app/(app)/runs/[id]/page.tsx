import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingState } from '@/components/app';
import { RunResultPage } from '@/features/scenarios/RunResultPage';

export const metadata: Metadata = { title: 'Run results' };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RunResultPage />
    </Suspense>
  );
}
