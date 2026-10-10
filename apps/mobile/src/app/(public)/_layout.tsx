import { Stack } from 'expo-router';

import { useTheme } from '@/theme/ThemeProvider';

export const unstable_settings = { initialRouteName: 'welcome' };

export default function PublicLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.colors.surface },
        headerTintColor: t.colors.text,
        contentStyle: { backgroundColor: t.colors.background },
      }}>
      <Stack.Screen name="welcome" options={{ headerShown: false, title: 'Welcome' }} />
      <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
      <Stack.Screen name="dev-sign-in" options={{ title: 'Dev sign-in' }} />
    </Stack>
  );
}
