import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingState } from '@/components/app';
import { ExplainPage } from '@/features/scenarios/ExplainPage';

export const metadata: Metadata = { title: 'Explain calculation' };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ExplainPage />
    </Suspense>
  );
}
