import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingState } from '@/components/app';
import { AuthPage } from '@/features/auth/AuthPage';

export const metadata: Metadata = { title: 'Create account' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 py-12 sm:px-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Create your WealthPilot account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign up with Google, Apple, Microsoft, email or a passkey.</p>
      </div>
      <div className="w-full">
        <Suspense fallback={<LoadingState rows={1} />}>
          <AuthPage kind="sign-up" />
        </Suspense>
      </div>
    </div>
  );
}
