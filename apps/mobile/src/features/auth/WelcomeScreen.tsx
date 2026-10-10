import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Disclaimer } from '@/components/finance';
import { Button, Card, Icon, Row, Screen, Stack, Text, type IconName } from '@/components/primitives';
import { useAuthSession } from '@/lib/auth/AuthContext';
import { useTheme } from '@/theme/ThemeProvider';

/** S01 Welcome */
export default function WelcomeScreen() {
  const t = useTheme();
  const auth = useAuthSession();
  return (
    <Screen edges={['top', 'bottom', 'left', 'right']} testID="welcome-screen">
      <Stack gap={20} style={styles.hero}>
        <View style={[styles.logo, { backgroundColor: t.colors.primary }]}>
          <Icon name="compass-outline" size={40} color={t.colors.onPrimary} />
        </View>
        <Text variant="display" center>
          WealthPilot
        </Text>
        <Text variant="heading" center tone="muted">
          See what you own across borders, understand the assumptions, and compare what happens next.
        </Text>
      </Stack>
      <Card>
        <Feature icon="globe-outline" text="One balance sheet across USD and INR, with your own FX rate." />
        <Feature icon="trending-up-outline" text="RSUs, 401(k), EPF, FDs and more — vested vs unvested kept separate." />
        <Feature icon="home-outline" text="Home and retirement scenarios you can compare and audit." />
        <Feature icon="lock-closed-outline" text="Manual entry. No bank logins required." />
      </Card>
      {auth.mode === 'unconfigured' ? (
        <Card tone="warning" testID="auth-unconfigured">
          <Text variant="bodyStrong">Sign-in is not configured for this build.</Text>
          <Text>
            Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, or EXPO_PUBLIC_DEV_AUTH=1 for local development against a dev API. See
            apps/mobile/README.md.
          </Text>
        </Card>
      ) : (
        <Stack gap={10}>
          <Button
            label="Get started"
            icon="arrow-forward"
            testID="welcome-get-started"
            onPress={() => router.push(auth.mode === 'dev' ? '/dev-sign-in' : '/sign-in')}
          />
          <Button
            label="I already have an account"
            variant="secondary"
            onPress={() => router.push(auth.mode === 'dev' ? '/dev-sign-in' : '/sign-in')}
          />
        </Stack>
      )}
      <Disclaimer />
      <Button label="Help and disclosures" variant="ghost" onPress={() => router.push('/help')} />
    </Screen>
  );
}

function Feature({ icon, text }: { icon: IconName; text: string }) {
  const t = useTheme();
  return (
    <Row gap={10} style={styles.feature}>
      <Icon name={icon} color={t.colors.primary} />
      <Text style={styles.flex}>{text}</Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: 24 },
  logo: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  feature: { alignItems: 'flex-start', paddingVertical: 4 },
  flex: { flex: 1 },
});
