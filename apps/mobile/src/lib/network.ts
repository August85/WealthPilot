import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

let wired = false;

/** Connect TanStack Query's online state to NetInfo (call once at startup). */
export function wireOnlineManager() {
  if (wired) return;
  wired = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      // `isInternetReachable` can be null while unknown; treat unknown as online.
      setOnline(state.isConnected !== false && state.isInternetReachable !== false);
    }),
  );
}

/** True when the device appears to be online. Writes are disabled when false. */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}

export class OfflineError extends Error {
  readonly name = 'OfflineError';
  constructor() {
    super('You are offline. Changes are disabled until you reconnect.');
  }
}

/** Throw if offline — used by every mutation so cached data stays read-only. */
export function assertOnline() {
  if (!onlineManager.isOnline()) throw new OfflineError();
}
