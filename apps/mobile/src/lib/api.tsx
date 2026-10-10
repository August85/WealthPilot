import { createApiClient, type ApiClient } from '@wealthpilot/contracts';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useAuthSession } from './auth/AuthContext';
import { env } from './env';

const ApiContext = createContext<ApiClient | null>(null);

/** Provides the typed API client. Tests pass a `client` built on a mocked fetch. */
export function ApiProvider({ children, client }: { children: ReactNode; client?: ApiClient }) {
  const auth = useAuthSession();
  // Auth providers keep getToken referentially stable, so the client is only rebuilt when auth changes.
  const getToken = auth.getToken;
  const value = useMemo(
    () =>
      client ??
      createApiClient({
        baseUrl: env.apiUrl,
        getToken,
      }),
    [client, getToken],
  );
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiProvider>');
  return api;
}
