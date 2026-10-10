import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { Button, ErrorState, LoadingState, Screen, Stack as VStack } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import { useAuthSession } from '@/lib/auth/AuthContext';
import { BiometricGate } from '@/lib/biometric';
import { errorMessage, useMe } from '@/lib/hooks';
import { AppProviders } from '@/lib/providers';
import { configureNotificationHandler } from '@/lib/push';
import { useTheme } from '@/theme/ThemeProvider';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  useEffect(() => {
    configureNotificationHandler();
    analytics.track('app_opened');
  }, []);
  return (
    <AppProviders>
      <BiometricGate>
        <RootNavigator />
      </BiometricGate>
    </AppProviders>
  );
}

function RootNavigator() {
  const t = useTheme();
  const auth = useAuthSession();
  const signedIn = auth.status === 'signedIn';
  const me = useMe(signedIn);

  const ready = auth.status !== 'loading' && (!signedIn || me.data !== undefined || me.isError);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) {
    return (
      <Screen scroll={false} edges={['top', 'bottom']}>
        <LoadingState label="Starting WealthPilot" />
      </Screen>
    );
  }

  if (signedIn && me.data === undefined && me.isError) {
    return (
      <Screen edges={['top', 'bottom']}>
        <VStack gap={16}>
          <ErrorState message={`Could not load your profile. ${errorMessage(me.error)}`} onRetry={() => me.refetch()} />
          <Button label="Sign out" variant="secondary" onPress={() => auth.signOut()} />
        </VStack>
      </Screen>
    );
  }

  const onboarded = !!me.data?.onboarding_completed;

  return (
    <>
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.colors.surface },
          headerTintColor: t.colors.text,
          headerTitleStyle: { color: t.colors.text },
          contentStyle: { backgroundColor: t.colors.background },
          headerBackButtonDisplayMode: 'minimal',
        }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(public)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !onboarded}>
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && onboarded}>
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
        </Stack.Protected>
        {/* Available signed in or out (S24). */}
        <Stack.Screen name="help" options={{ title: 'Help & disclosures' }} />
      </Stack>
    </>
  );
}
