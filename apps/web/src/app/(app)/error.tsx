'use client';

import { ErrorState } from '@/components/app';

/** Render errors inside the app shell (never shows stack traces or data). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      message={`This page hit an unexpected problem${error.digest ? ` (ref ${error.digest})` : ''}. Your data is safe.`}
      onRetry={reset}
    />
  );
}
