import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useUiStore } from '../store/ui';
import { useApi } from './api';
import { useAuthSession } from './auth/AuthContext';
import { unregisterPush } from './push';
import { persister } from './query';

/**
 * Sign out and leave nothing financial behind on the device: unregister this device's push token
 * (best effort), drop the in-memory and persisted query caches, reset UI state, then end the session.
 */
export function useSignOutEverywhere() {
  const api = useApi();
  const qc = useQueryClient();
  const { signOut } = useAuthSession();
  return useCallback(
    async (opts: { skipPush?: boolean } = {}) => {
      if (!opts.skipPush) await unregisterPush(api).catch(() => undefined);
      qc.clear();
      try {
        await persister.removeClient();
      } catch {
        // storage unavailable; in-memory cache is already cleared
      }
      useUiStore.getState().reset();
      await signOut();
    },
    [api, qc, signOut],
  );
}
