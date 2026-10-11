'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ApiClient } from '@wealthpilot/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';

import { ConflictDialog } from '@/components/app';
import { ApiProvider } from '@/lib/api';
import { ClerkAuthBridge } from '@/lib/auth/ClerkAuthBridge';
import { AuthContext, useAuthSession } from '@/lib/auth/context';
import { DevAuthProvider } from '@/lib/auth/DevAuthProvider';
import { env } from '@/lib/env';
import { createAppQueryClient } from '@/lib/query';
import { hydrateUiPreferences, useUiStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';

function AuthProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
  if (env.authMode === 'clerk' && env.clerkPublishableKey) {
    return (
      <ClerkProvider
        publishableKey={env.clerkPublishableKey}
        nonce={nonce}
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        signInFallbackRedirectUrl="/overview"
        signUpFallbackRedirectUrl="/onboarding"
        afterSignOutUrl="/">
        <ClerkAuthBridge>{children}</ClerkAuthBridge>
      </ClerkProvider>
    );
  }
  if (env.authMode === 'dev') return <DevAuthProvider>{children}</DevAuthProvider>;
  return (
    <AuthContext.Provider value={{ mode: 'unconfigured', status: 'signedOut', getToken: async () => null, signOut: async () => {} }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Clears cached server data whenever the signed-in identity changes (no data leaks between sessions). */
function SessionBoundary({ client, children }: { client: QueryClient; children: ReactNode }) {
  const { status, label } = useAuthSession();
  const prev = useRef<string | null>(null);
  useEffect(() => {
    // 'loading' is the initial, pre-hydration state; only a change between two settled identities clears data.
    if (status === 'loading') return;
    const key = status === 'signedIn' ? `in:${label ?? ''}` : status;
    if (prev.current !== null && prev.current !== key) {
      // Drop everything cached for the previous identity. Mounted queries are reset (data wiped, refetched with
      // the new token) rather than removed: child effects run first, so removing them would strand their
      // observers on a query that no longer exists and leave the app on its loading screen.
      client.getMutationCache().clear();
      client.removeQueries({ type: 'inactive' });
      void client.resetQueries({ type: 'active' });
      useUiStore.getState().reset();
    }
    prev.current = key;
  }, [status, label, client]);
  return children;
}

function ThemedToaster() {
  const { preference } = useTheme();
  return <Toaster position="bottom-right" richColors closeButton theme={preference} />;
}

const PLAN_LIMIT_EVENT = 'wp:plan-limit';

/** Routes 402 PLAN_LIMIT responses (raised outside React by the QueryClient) to the subscription page. */
function PlanLimitRedirect() {
  const router = useRouter();
  useEffect(() => {
    const onLimit = (e: Event) => {
      const reason = (e as CustomEvent<string>).detail;
      router.push(`/subscription?reason=${encodeURIComponent(reason)}`);
    };
    window.addEventListener(PLAN_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, onLimit);
  }, [router]);
  return null;
}

function makeQueryClient(): QueryClient {
  const qc: QueryClient = createAppQueryClient({
    onPlanLimit: (err) => {
      window.dispatchEvent(new CustomEvent(PLAN_LIMIT_EVENT, { detail: err.detail ?? err.code ?? 'plan_limit' }));
    },
    onUnauthorized: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onVersionConflict: () => {
      useUiStore.getState().showConflict({ entity: 'this item', onReload: () => qc.invalidateQueries() });
    },
  });
  return qc;
}

export function Providers({ children, nonce }: { children: ReactNode; nonce?: string }) {
  const [client] = useState(makeQueryClient);

  useEffect(() => {
    hydrateUiPreferences();
  }, []);

  return (
    <AuthProvider nonce={nonce}>
      <QueryClientProvider client={client}>
        <SessionBoundary client={client}>
          <ApiProvider>
            {children}
            <ConflictDialog />
            <PlanLimitRedirect />
            <ThemedToaster />
          </ApiProvider>
        </SessionBoundary>
      </QueryClientProvider>
    </AuthProvider>
  );
}

/** Test providers: plain QueryClient and an injected API client, signed in. */
export function TestProviders({ children, client, api }: { children: ReactNode; client: QueryClient; api: ApiClient }) {
  return (
    <AuthContext.Provider
      value={{ mode: 'dev', status: 'signedIn', getToken: async () => 'dev:test:test@example.com', signOut: async () => {}, label: 'test' }}>
      <QueryClientProvider client={client}>
        <ApiProvider client={api}>
          {children}
          <ConflictDialog />
        </ApiProvider>
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}
