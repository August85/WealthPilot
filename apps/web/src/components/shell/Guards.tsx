'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { ErrorState } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { useAuthSession } from '@/lib/auth/context';
import { errorMessage, useMe } from '@/lib/hooks';

import { BrandMark } from './Brand';

export function FullPageLoading({ label = 'Loading WealthPilot' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <BrandMark className="size-12" />
      <Skeleton className="h-2 w-40" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

type Want = 'app' | 'onboarding';

/**
 * Client-side routing guard (mirrors the mobile root navigator):
 * signed out → /sign-in; signed in but not onboarded → /onboarding; onboarded → the app.
 * With Clerk configured the proxy also protects these routes on the server.
 */
export function RequireSession({ want, children }: { want: Want; children: ReactNode }) {
  const auth = useAuthSession();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const signedIn = auth.status === 'signedIn';
  const me = useMe(signedIn);
  const onboarded = me.data?.onboarding_completed;

  let redirect: string | null = null;
  if (auth.status === 'signedOut') redirect = `/sign-in?redirect_url=${encodeURIComponent(pathname)}`;
  else if (signedIn && me.data) {
    if (want === 'app' && !onboarded) redirect = '/onboarding';
    if (want === 'onboarding' && onboarded) redirect = '/overview';
  }

  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  if (signedIn && me.data === undefined && me.isError) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-6">
        <ErrorState message={`Could not load your profile. ${errorMessage(me.error)}`} onRetry={() => void me.refetch()} />
        <Button variant="outline" onClick={() => void auth.signOut()}>
          Sign out
        </Button>
      </div>
    );
  }
  if (redirect || auth.status === 'loading' || !me.data) return <FullPageLoading />;
  return children;
}
