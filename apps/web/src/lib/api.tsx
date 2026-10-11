'use client';

import { createApiClient, type ApiClient } from '@wealthpilot/contracts';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useAuthSession } from './auth/context';
import { env } from './env';

const ApiContext = createContext<ApiClient | null>(null);

/** Provides the typed API client (the same `@wealthpilot/contracts` client the mobile app uses). */
export function ApiProvider({ children, client }: { children: ReactNode; client?: ApiClient }) {
  const { getToken } = useAuthSession();
  const value = useMemo(() => client ?? createApiClient({ baseUrl: env.apiUrl, getToken }), [client, getToken]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiProvider>');
  return api;
}
