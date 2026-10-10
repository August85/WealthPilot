import { useSignIn, useSignUp, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { PlainTextInput } from '@/components/form';
import { Disclaimer } from '@/components/finance';
import { Button, Card, Divider, Screen, Stack, Text, type IconName } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import { env } from '@/lib/env';

WebBrowser.maybeCompleteAuthSession();

type Strategy = 'oauth_google' | 'oauth_apple' | 'oauth_microsoft';

const PROVIDERS: { strategy: Strategy; label: string; icon: IconName }[] = [
  { strategy: 'oauth_apple', label: 'Continue with Apple', icon: 'logo-apple' },
  { strategy: 'oauth_google', label: 'Continue with Google', icon: 'logo-google' },
  { strategy: 'oauth_microsoft', label: 'Continue with Microsoft', icon: 'logo-microsoft' },
];

function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

function clerkMessage(e: unknown): string {
  if (e && typeof e === 'object') {
    const anyE = e as { longMessage?: string; message?: string; errors?: { longMessage?: string; message?: string }[] };
    return anyE.errors?.[0]?.longMessage ?? anyE.longMessage ?? anyE.message ?? 'Sign-in failed';
  }
  return 'Sign-in failed';
}

/** S02 Sign up / sign in (Clerk): social SSO, email code, passkeys where enabled. */
export default function ClerkSignIn() {
  useWarmUpBrowser();
  const { startSSOFlow } = useSSO();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [flow, setFlow] = useState<'signIn' | 'signUp'>('signIn');

  const sso = async (strategy: Strategy) => {
    setError(null);
    setBusy(strategy);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy,
        redirectUrl: AuthSession.makeRedirectUri({ scheme: 'wealthpilot', path: 'sso-callback' }),
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        analytics.track('signed_in', { reason: strategy });
      }
    } catch (e) {
      setError(clerkMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const sendCode = async () => {
    setError(null);
    setBusy('email');
    try {
      const res = await signIn.emailCode.sendCode({ emailAddress: email.trim() });
      if (res.error) {
        if (res.error.code === 'form_identifier_not_found') {
          // New user: sign up with the same email-code flow.
          const created = await signUp.create({ emailAddress: email.trim() });
          if (created.error) throw created.error;
          const sent = await signUp.verifications.sendEmailCode();
          if (sent.error) throw sent.error;
          setFlow('signUp');
        } else {
          throw res.error;
        }
      } else {
        setFlow('signIn');
      }
      setStage('code');
    } catch (e) {
      setError(clerkMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy('verify');
    try {
      if (flow === 'signIn') {
        const res = await signIn.emailCode.verifyCode({ code: code.trim() });
        if (res.error) throw res.error;
        const fin = await signIn.finalize();
        if (fin.error) throw fin.error;
      } else {
        const res = await signUp.verifications.verifyEmailCode({ code: code.trim() });
        if (res.error) throw res.error;
        const fin = await signUp.finalize();
        if (fin.error) throw fin.error;
      }
      analytics.track('signed_in', { reason: 'email_code' });
    } catch (e) {
      setError(clerkMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const passkey = async () => {
    setError(null);
    setBusy('passkey');
    try {
      const res = await signIn.passkey({ flow: 'discoverable' });
      if (res.error) throw res.error;
      const fin = await signIn.finalize();
      if (fin.error) throw fin.error;
      analytics.track('signed_in', { reason: 'passkey' });
    } catch (e) {
      setError(clerkMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen testID="sign-in-screen">
      <Text variant="title">Sign in or create an account</Text>
      <Text tone="muted">
        WealthPilot never asks for bank passwords. Your sign-in is handled by our identity provider; you can add a passkey
        or two-factor authentication in your account settings.
      </Text>
      <Stack gap={10}>
        {PROVIDERS.filter((p) => p.strategy !== 'oauth_apple' || Platform.OS !== 'android').map((p) => (
          <Button
            key={p.strategy}
            label={p.label}
            icon={p.icon}
            variant="secondary"
            loading={busy === p.strategy}
            disabled={!!busy && busy !== p.strategy}
            onPress={() => sso(p.strategy)}
            testID={`sso-${p.strategy}`}
          />
        ))}
        {env.passkeys ? (
          <Button
            label="Sign in with a passkey"
            icon="key-outline"
            variant="secondary"
            loading={busy === 'passkey'}
            onPress={passkey}
          />
        ) : null}
      </Stack>
      <Divider />
      <Card>
        <Text variant="heading">Email code</Text>
        {stage === 'email' ? (
          <Stack gap={10}>
            <Text variant="label">Email address</Text>
            <PlainTextInput
              label="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="you@example.com"
              testID="email-input"
            />
            <Button label="Email me a code" onPress={sendCode} loading={busy === 'email'} disabled={!email.includes('@')} />
          </Stack>
        ) : (
          <Stack gap={10}>
            <Text>We sent a 6-digit code to {email}.</Text>
            <Text variant="label">Verification code</Text>
            <PlainTextInput label="Verification code" value={code} onChangeText={setCode} keyboardType="number-pad" />
            <Button label={flow === 'signUp' ? 'Create account' : 'Sign in'} onPress={verify} loading={busy === 'verify'} />
            <Button label="Use a different email" variant="ghost" onPress={() => setStage('email')} />
          </Stack>
        )}
      </Card>
      {error ? (
        <Card tone="danger">
          <Text tone="danger" accessibilityRole="alert">
            ⚠ {error}
          </Text>
        </Card>
      ) : null}
      <Disclaimer compact />
    </Screen>
  );
}
