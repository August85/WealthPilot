import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { useCallback, useMemo, type ReactNode } from 'react';

import { AuthContext, type AuthSession } from './AuthContext';

const JWT_TEMPLATE = process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE?.trim() || undefined;

/**
 * Clerk-backed auth (Google, Apple, Microsoft SSO, email code, passkeys where enabled).
 * The Clerk client token is cached in SecureStore via `@clerk/expo/token-cache`; the API receives the
 * short-lived Clerk session JWT as the bearer token.
 */
export function ClerkAuthProvider({
  publishableKey,
  passkeys,
  children,
}: {
  publishableKey: string;
  passkeys?: unknown;
  children: ReactNode;
}) {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={tokenCache}
      {...(passkeys ? { __experimental_passkeys: passkeys as never } : {})}>
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  );
}

function ClerkBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const stableGetToken = useCallback(async () => {
    try {
      return (await getToken(JWT_TEMPLATE ? { template: JWT_TEMPLATE } : undefined)) ?? null;
    } catch {
      return null;
    }
  }, [getToken]);

  const value = useMemo<AuthSession>(
    () => ({
      mode: 'clerk',
      status: !isLoaded ? 'loading' : isSignedIn ? 'signedIn' : 'signedOut',
      getToken: stableGetToken,
      signOut: async () => {
        await signOut();
      },
    }),
    [isLoaded, isSignedIn, stableGetToken, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
