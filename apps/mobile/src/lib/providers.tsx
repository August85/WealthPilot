import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { ApiClient } from '@wealthpilot/contracts';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConflictDialog } from '../components/app';
import { useUiStore } from '../store/ui';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ApiProvider } from './api';
import { AuthProvider } from './auth/AuthProvider';
import { wireOnlineManager } from './network';
import { PERSIST_BUSTER, PERSIST_MAX_AGE, createAppQueryClient, persister, shouldPersistQuery } from './query';

function makeClient(): QueryClient {
  const client: QueryClient = createAppQueryClient({
    onPlanLimit: (err) => {
      router.push({ pathname: '/subscription', params: { reason: err.detail ?? 'plan_limit' } });
    },
    onUnauthorized: () => {
      void client.invalidateQueries({ queryKey: ['me'] });
    },
    onVersionConflict: () => {
      useUiStore.getState().showConflict({
        entity: 'this item',
        onReload: () => client.invalidateQueries(),
      });
    },
  });
  return client;
}

/** All app-wide providers. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    wireOnlineManager();
    return makeClient();
  });
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <PersistQueryClientProvider
            client={client}
            persistOptions={{
              persister,
              buster: PERSIST_BUSTER,
              maxAge: PERSIST_MAX_AGE,
              dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
            }}>
            <ApiProvider>
              {children}
              <ConflictDialog />
            </ApiProvider>
          </PersistQueryClientProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** Test providers: plain QueryClient (no persistence) and an injected API client. */
export function TestProviders({
  children,
  client,
  api,
  scheme = 'light',
}: {
  children: ReactNode;
  client: QueryClient;
  api: ApiClient;
  scheme?: 'light' | 'dark';
}) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <ThemeProvider scheme={scheme}>
        <QueryClientProvider client={client}>
          <ApiProvider client={api}>
            {children}
            <ConflictDialog />
          </ApiProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
