import type { ReactNode } from 'react';

import { env } from '../env';
import { AuthContext, type AuthSession } from './AuthContext';
import { ClerkAuthProvider } from './ClerkAuthProvider';
import { DevAuthProvider } from './DevAuthProvider';

/**
 * Passkeys need the native @clerk/expo-passkeys module (development build, not Expo Go), so the adapter is
 * only loaded when EXPO_PUBLIC_CLERK_PASSKEYS=1.
 */
function loadPasskeys(): unknown {
  if (!env.passkeys) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@clerk/expo/passkeys').passkeys;
  } catch {
    return undefined;
  }
}

const UNCONFIGURED: AuthSession = {
  mode: 'unconfigured',
  status: 'signedOut',
  getToken: async () => null,
  signOut: async () => {},
};

export function AuthProvider({ children }: { children: ReactNode }) {
  if (env.authMode === 'clerk' && env.clerkPublishableKey) {
    return (
      <ClerkAuthProvider publishableKey={env.clerkPublishableKey} passkeys={loadPasskeys()}>
        {children}
      </ClerkAuthProvider>
    );
  }
  if (env.authMode === 'dev') {
    return <DevAuthProvider>{children}</DevAuthProvider>;
  }
  return (
<AuthContext.Provider value={UNCONFIGURED}>{children}</AuthContext.Provider>
  );
}
