import { Stack } from 'expo-router';

import { OfflineBanner } from '@/components/app';
import { useTheme } from '@/theme/ThemeProvider';

export const unstable_settings = { initialRouteName: '(tabs)' };

/** Signed-in, onboarded area: bottom tabs plus pushed detail screens. */
export default function AppLayout() {
  const t = useTheme();
  return (
    <>
      <OfflineBanner />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.colors.surface },
          headerTintColor: t.colors.text,
          contentStyle: { backgroundColor: t.colors.background },
          headerBackButtonDisplayMode: 'minimal',
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="accounts/new" options={{ title: 'Add account', presentation: 'modal' }} />
        <Stack.Screen name="accounts/[id]" options={{ title: 'Account' }} />
        <Stack.Screen name="epf/[id]" options={{ title: 'EPF details' }} />
        <Stack.Screen name="rsu/index" options={{ title: 'RSU grants' }} />
        <Stack.Screen name="rsu/new" options={{ title: 'New RSU grant', presentation: 'modal' }} />
        <Stack.Screen name="rsu/[id]" options={{ title: 'RSU grant' }} />
        <Stack.Screen name="rsu/calendar" options={{ title: 'Vest calendar' }} />
        <Stack.Screen name="fx" options={{ title: 'FX assumptions' }} />
        <Stack.Screen name="goals/new" options={{ title: 'New goal', presentation: 'modal' }} />
        <Stack.Screen name="goals/[id]" options={{ title: 'Goal' }} />
        <Stack.Screen name="plan/home" options={{ title: 'Home planner' }} />
        <Stack.Screen name="plan/retirement" options={{ title: 'Retirement planner' }} />
        <Stack.Screen name="scenarios/new" options={{ title: 'New scenario', presentation: 'modal' }} />
        <Stack.Screen name="scenarios/[id]" options={{ title: 'Scenario' }} />
        <Stack.Screen name="scenarios/compare" options={{ title: 'Compare scenarios' }} />
        <Stack.Screen name="runs/[id]" options={{ title: 'Run results' }} />
        <Stack.Screen name="runs/explain" options={{ title: 'Explain calculation' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="export" options={{ title: 'Export data' }} />
        <Stack.Screen name="security" options={{ title: 'Privacy & security' }} />
        <Stack.Screen name="subscription" options={{ title: 'Subscription' }} />
        <Stack.Screen name="residency" options={{ title: 'Tax residency' }} />
      </Stack>
    </>
  );
}
