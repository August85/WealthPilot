import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingState } from '@/components/app';
import { SubscriptionPage } from '@/features/profile/SubscriptionPage';

export const metadata: Metadata = { title: 'Subscription' };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SubscriptionPage />
    </Suspense>
  );
}
