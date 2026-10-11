'use client';

import { buildDevToken } from '@wealthpilot/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { sessionGet, sessionSet } from '../utils';
import { AuthContext, type AuthSession } from './context';

export const DEV_TOKEN_KEY = 'wp.devToken';

/**
 * Local development only (NEXT_PUBLIC_DEV_AUTH=1 and no Clerk key). Sends `dev:<subject>:<email>` bearer tokens,
 * which the API accepts only when WP_AUTH_MODE=dev. The token lives in sessionStorage (this tab only).
 */
export function DevAuthProvider({ children }: { children: ReactNode }) {
  // undefined = not read from sessionStorage yet (first render on the client matches the server render).
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const t = sessionGet(DEV_TOKEN_KEY);
    tokenRef.current = t;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is only readable after hydration
    setToken(t);
  }, []);

  const devSignIn = useCallback(async (subject: string, email: string) => {
    const next = buildDevToken(subject, email);
    if (!next) throw new Error('Enter a subject (letters, numbers, - _ .) and a valid email');
    sessionSet(DEV_TOKEN_KEY, next);
    tokenRef.current = next;
    setToken(next);
  }, []);

  const signOut = useCallback(async () => {
    sessionSet(DEV_TOKEN_KEY, null);
    tokenRef.current = null;
    setToken(null);
  }, []);

  const getToken = useCallback(async () => tokenRef.current, []);

  const value = useMemo<AuthSession>(
    () => ({
      mode: 'dev',
      status: token === undefined ? 'loading' : token ? 'signedIn' : 'signedOut',
      getToken,
      signOut,
      devSignIn,
      label: token ? (token.split(':')[2] ?? null) : null,
    }),
    [token, getToken, signOut, devSignIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
