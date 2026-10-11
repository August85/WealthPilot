'use client';

import { useAuth, useUser } from '@clerk/nextjs';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { env } from '../env';
import { AuthContext, type AuthSession } from './context';

/**
 * Exposes Clerk's session through the app's AuthContext. The API receives the Clerk session JWT as
 * `Authorization: Bearer` (optionally from a JWT template). Must render inside <ClerkProvider>.
 */
export function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const { user } = useUser();
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const stableGetToken = useCallback(async () => {
    const template = env.clerkJwtTemplate;
    return (await getTokenRef.current(template ? { template } : undefined)) ?? null;
  }, []);

  const stableSignOut = useCallback(async () => {
    await signOut({ redirectUrl: '/' });
  }, [signOut]);

  const label = user?.primaryEmailAddress?.emailAddress ?? null;
  const value = useMemo<AuthSession>(
    () => ({
      mode: 'clerk',
      status: !isLoaded ? 'loading' : isSignedIn ? 'signedIn' : 'signedOut',
      getToken: stableGetToken,
      signOut: stableSignOut,
      label,
    }),
    [isLoaded, isSignedIn, stableGetToken, stableSignOut, label],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
