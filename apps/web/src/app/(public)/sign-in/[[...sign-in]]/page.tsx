import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingState } from '@/components/app';
import { AuthPage } from '@/features/auth/AuthPage';

export const metadata: Metadata = { title: 'Sign in' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 py-12 sm:px-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to WealthPilot</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use the same account as the mobile app.</p>
      </div>
      <div className="w-full">
        <Suspense fallback={<LoadingState rows={1} />}>
          <AuthPage kind="sign-in" />
        </Suspense>
      </div>
    </div>
  );
}
