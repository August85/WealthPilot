'use client';

import { createContext, useContext } from 'react';

import type { AuthMode } from '../env';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface AuthSession {
  mode: AuthMode;
  status: AuthStatus;
  /** Bearer token for the API: the Clerk session JWT, or `dev:<subject>:<email>` in dev mode. */
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Dev mode only. */
  devSignIn?: (subject: string, email: string) => Promise<void>;
  /** Display-only identity hint (never sent to analytics). */
  label?: string | null;
}

const noop = async () => {};

export const AuthContext = createContext<AuthSession>({
  mode: 'unconfigured',
  status: 'signedOut',
  getToken: async () => null,
  signOut: noop,
});

export function useAuthSession(): AuthSession {
  return useContext(AuthContext);
}
