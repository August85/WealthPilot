import { Redirect } from 'expo-router';

import { Card, Screen, Text } from '@/components/primitives';
import { useAuthSession } from '@/lib/auth/AuthContext';

import ClerkSignIn from './ClerkSignIn';

/** S02 — routes to the configured sign-in implementation. */
export default function SignInScreen() {
  const auth = useAuthSession();
  if (auth.mode === 'clerk') return <ClerkSignIn />;
  if (auth.mode === 'dev') return <Redirect href="/dev-sign-in" />;
  return (
    <Screen>
      <Card tone="warning">
        <Text>Sign-in is not configured. Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY (see README).</Text>
      </Card>
    </Screen>
  );
}
