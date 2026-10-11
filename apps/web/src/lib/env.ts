/**
 * Runtime configuration from NEXT_PUBLIC_* variables (inlined into the bundle at build time).
 * Each variable is read with a static `process.env.NEXT_PUBLIC_X` expression so Next.js can inline it.
 */

export type AuthMode = 'clerk' | 'dev' | 'unconfigured';

export interface WebEnv {
  apiUrl: string;
  clerkPublishableKey: string | null;
  clerkJwtTemplate: string | null;
  devAuth: boolean;
  authMode: AuthMode;
}

function clean(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t.length ? t : null;
}

export function readEnv(): WebEnv {
  const clerkPublishableKey = clean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const devAuth = process.env.NEXT_PUBLIC_DEV_AUTH === '1';
  // Dev sign-in is only ever offered when Clerk is NOT configured.
  const authMode: AuthMode = clerkPublishableKey ? 'clerk' : devAuth ? 'dev' : 'unconfigured';
  return {
    apiUrl: clean(process.env.NEXT_PUBLIC_API_URL) ?? 'http://localhost:8000/v1',
    clerkPublishableKey,
    clerkJwtTemplate: clean(process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE),
    devAuth,
    authMode,
  };
}

export const env: WebEnv = readEnv();
