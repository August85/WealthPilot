import { Stack } from 'expo-router';

import { useTheme } from '@/theme/ThemeProvider';

export const unstable_settings = { initialRouteName: 'residency' };

export default function OnboardingLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.colors.surface },
        headerTintColor: t.colors.text,
        contentStyle: { backgroundColor: t.colors.background },
      }}>
      <Stack.Screen name="residency" options={{ title: 'Step 1 of 2 · Residency' }} />
      <Stack.Screen name="household" options={{ title: 'Step 2 of 2 · Household' }} />
    </Stack>
  );
}
