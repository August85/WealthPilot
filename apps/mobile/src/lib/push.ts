import type { ApiClient } from '@wealthpilot/contracts';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { env } from './env';
import { STORAGE_KEYS, secureStorage } from './secureStorage';

let handlerSet = false;

/** Foreground presentation. Push bodies never contain amounts (FR-NOT-002) — the server guarantees that. */
export function configureNotificationHandler() {
  if (handlerSet || Platform.OS === 'web') return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export type PushResult = { ok: true; token: string } | { ok: false; reason: string };

function projectId(): string | undefined {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return env.easProjectId ?? fromConfig ?? Constants.easConfig?.projectId ?? undefined;
}

/** Ask permission (opt-in), get an Expo push token and register it with the API. */
export async function registerForPush(api: ApiClient): Promise<PushResult> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { ok: false, reason: 'Push notifications are available in the iOS and Android apps.' };
  }
  if (!Device.isDevice) return { ok: false, reason: 'Push notifications need a physical device.' };
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.granted;
  }
  if (!granted) return { ok: false, reason: 'Notifications permission was not granted. You can change this in Settings.' };
  const pid = projectId();
  if (!pid) return { ok: false, reason: 'Push is not configured for this build (missing EAS project ID).' };
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: pid })).data;
  await api.notifications.registerDevice({ expo_push_token: token, platform: Platform.OS });
  await secureStorage.set(STORAGE_KEYS.pushToken, token);
  return { ok: true, token };
}

/** Remove this device's push token from the API (on sign-out or opt-out). */
export async function unregisterPush(api: ApiClient): Promise<void> {
  const token = await secureStorage.get(STORAGE_KEYS.pushToken);
  if (!token) return;
  try {
    await api.notifications.unregisterDevice(token);
  } catch {
    // best effort
  }
  await secureStorage.remove(STORAGE_KEYS.pushToken);
}

export async function hasRegisteredPush(): Promise<boolean> {
  return !!(await secureStorage.get(STORAGE_KEYS.pushToken));
}
