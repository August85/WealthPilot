import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { STORAGE_KEYS, secureStorage } from '../secureStorage';
import { AuthContext, buildDevToken, type AuthSession, type AuthStatus } from './AuthContext';

/**
 * Development-only auth (EXPO_PUBLIC_DEV_AUTH=1 and no Clerk key). Sends `dev:<subject>:<email>` bearer
 * tokens, which the API accepts only when `WP_AUTH_MODE=dev`. Never enabled in production builds.
 */
export function DevAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    secureStorage.get(STORAGE_KEYS.devToken).then((t) => {
      if (!alive) return;
      tokenRef.current = t;
      setStatus(t ? 'signedIn' : 'signedOut');
    });
    return () => {
      alive = false;
    };
  }, []);

  const devSignIn = useCallback(async (subject: string, email: string) => {
    const token = buildDevToken(subject, email);
    if (!token) throw new Error('Enter a subject (letters, numbers, - _ .) and a valid email');
    await secureStorage.set(STORAGE_KEYS.devToken, token);
    tokenRef.current = token;
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(async () => {
    await secureStorage.remove(STORAGE_KEYS.devToken);
    tokenRef.current = null;
    setStatus('signedOut');
  }, []);

  const value = useMemo<AuthSession>(
    () => ({ mode: 'dev', status, getToken: async () => tokenRef.current, signOut, devSignIn }),
    [status, signOut, devSignIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
