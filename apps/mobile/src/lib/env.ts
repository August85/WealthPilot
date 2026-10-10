/**
 * Runtime configuration from EXPO_PUBLIC_* variables (inlined at bundle time by Expo).
 * Access each variable with a static `process.env.EXPO_PUBLIC_X` expression so Metro can inline it.
 */

export type AuthMode = 'clerk' | 'dev' | 'unconfigured';

export interface AppEnv {
  apiUrl: string;
  clerkPublishableKey: string | null;
  devAuth: boolean;
  passkeys: boolean;
  revenueCatIosKey: string | null;
  revenueCatAndroidKey: string | null;
  easProjectId: string | null;
  authMode: AuthMode;
}

function clean(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t.length ? t : null;
}

export function readEnv(): AppEnv {
  const clerkPublishableKey = clean(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const devAuth = process.env.EXPO_PUBLIC_DEV_AUTH === '1';
  const authMode: AuthMode = clerkPublishableKey ? 'clerk' : devAuth ? 'dev' : 'unconfigured';
  return {
    apiUrl: clean(process.env.EXPO_PUBLIC_API_URL) ?? 'http://localhost:8000/v1',
    clerkPublishableKey,
    devAuth,
    passkeys: process.env.EXPO_PUBLIC_CLERK_PASSKEYS === '1',
    revenueCatIosKey: clean(process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY),
    revenueCatAndroidKey: clean(process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY),
    easProjectId: clean(process.env.EXPO_PUBLIC_EAS_PROJECT_ID),
    authMode,
  };
}

export const env: AppEnv = readEnv();
