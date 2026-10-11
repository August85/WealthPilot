import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingState } from '@/components/app';
import { ExportPage } from '@/features/profile/ExportPage';

export const metadata: Metadata = { title: 'Export data' };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ExportPage />
    </Suspense>
  );
}
