import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingState } from '@/components/app';
import { ComparePage } from '@/features/scenarios/ComparePage';

export const metadata: Metadata = { title: 'Compare scenarios' };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ComparePage />
    </Suspense>
  );
}
