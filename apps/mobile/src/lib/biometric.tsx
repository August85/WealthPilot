import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import { Button, Icon, Stack, Text } from '../components/primitives';
import { useUiStore } from '../store/ui';
import { useTheme } from '../theme/ThemeProvider';
import { STORAGE_KEYS, secureStorage } from './secureStorage';

export async function biometricAvailability(): Promise<{ available: boolean; reason?: string }> {
  if (Platform.OS === 'web') return { available: false, reason: 'Not available on web.' };
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return { available: false, reason: 'This device has no biometric hardware.' };
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) return { available: false, reason: 'No Face ID / fingerprint is enrolled on this device.' };
    return { available: true };
  } catch {
    return { available: false, reason: 'Biometric check failed.' };
  }
}

export async function authenticateBiometric(reason = 'Unlock WealthPilot'): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    return res.success;
  } catch {
    return false;
  }
}

export function useBiometricSetting() {
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  useEffect(() => {
    secureStorage.get(STORAGE_KEYS.biometricLock).then((v) => setEnabledState(v === '1'));
  }, []);
  const setEnabled = useCallback(async (v: boolean) => {
    if (v) {
      const ok = await authenticateBiometric('Confirm to turn on biometric lock');
      if (!ok) return false;
      await secureStorage.set(STORAGE_KEYS.biometricLock, '1');
    } else {
      await secureStorage.remove(STORAGE_KEYS.biometricLock);
    }
    setEnabledState(v);
    return true;
  }, []);
  return { enabled, setEnabled };
}

/** Optional biometric unlock (spec §11.2). Locks again when the app goes to the background. */
export function BiometricGate({ children }: { children: ReactNode }) {
  const t = useTheme();
  const unlocked = useUiStore((s) => s.unlocked);
  const setUnlocked = useUiStore((s) => s.setUnlocked);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const prompted = useRef(false);

  useEffect(() => {
    secureStorage.get(STORAGE_KEYS.biometricLock).then((v) => setEnabled(v === '1'));
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        prompted.current = false;
        setUnlocked(false);
        secureStorage.get(STORAGE_KEYS.biometricLock).then((v) => setEnabled(v === '1'));
      }
    });
    return () => sub.remove();
  }, [setUnlocked]);

  const unlock = useCallback(async () => {
    const ok = await authenticateBiometric();
    if (ok) setUnlocked(true);
  }, [setUnlocked]);

  useEffect(() => {
    if (enabled && !unlocked && !prompted.current) {
      prompted.current = true;
      void unlock();
    }
  }, [enabled, unlocked, unlock]);

  if (enabled === null) return null;
  if (!enabled || unlocked) return <>{children}</>;
  return (
    <View style={[styles.lock, { backgroundColor: t.colors.background }]} testID="biometric-lock">
      <Stack gap={16} style={styles.center}>
        <Icon name="lock-closed" size={48} color={t.colors.primary} />
        <Text variant="title" center>
          WealthPilot is locked
        </Text>
        <Text tone="muted" center>
          Use Face ID, Touch ID or your device passcode to continue.
        </Text>
        <Button label="Unlock" icon="finger-print" onPress={unlock} testID="biometric-unlock" />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  lock: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  center: { alignItems: 'center' },
});
