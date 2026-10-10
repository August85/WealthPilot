/**
 * Small key/value wrapper over expo-secure-store (iOS Keychain / Android Keystore, spec §11.2).
 * On web (development companion only) SecureStore is unavailable, so values live in memory for the tab.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const memory = new Map<string, string>();
const isWeb = Platform.OS === 'web';

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (isWeb) return memory.get(key) ?? null;
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    if (isWeb) {
      memory.set(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
  async remove(key: string): Promise<void> {
    if (isWeb) {
      memory.delete(key);
      return;
    }
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // already absent
    }
  },
};

export const STORAGE_KEYS = {
  devToken: 'wp.dev_token',
  biometricLock: 'wp.biometric_lock',
  pushToken: 'wp.push_token',
} as const;
