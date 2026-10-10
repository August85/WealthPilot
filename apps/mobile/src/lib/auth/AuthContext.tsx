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

/** Validate dev-mode identity pieces; the token format is `dev:<subject>:<email>`. */
export function buildDevToken(subject: string, email: string): string | null {
  const s = subject.trim();
  const e = email.trim().toLowerCase();
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(s)) return null;
  if (!/^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(e)) return null;
  return `dev:${s}:${e}`;
}
