import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormError } from '@/components/app';
import { TextField } from '@/components/form';
import { Button, Card, Icon, Row, Screen, Text } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import { useAuthSession } from '@/lib/auth/AuthContext';
import { env } from '@/lib/env';
import { useState } from 'react';

export const devSignInSchema = z.object({
  subject: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{1,64}$/, 'Letters, numbers, dot, dash or underscore'),
  email: z.string().trim().email('Enter a valid email'),
});

/**
 * Dev sign-in — only when EXPO_PUBLIC_DEV_AUTH=1 and no Clerk key. Sends `dev:<subject>:<email>` bearer
 * tokens, which the API accepts only in WP_AUTH_MODE=dev.
 */
export default function DevSignInScreen() {
  const auth = useAuthSession();
  const [error, setError] = useState<unknown>(null);
  const { control, handleSubmit, formState } = useForm<z.infer<typeof devSignInSchema>>({
    resolver: zodResolver(devSignInSchema),
    defaultValues: { subject: 'dev-user-1', email: 'dev@example.com' },
  });

  if (auth.mode !== 'dev' || !auth.devSignIn) {
    return (
      <Screen>
        <Card tone="warning">
          <Text>Dev sign-in is disabled. It requires EXPO_PUBLIC_DEV_AUTH=1 and no Clerk publishable key.</Text>
        </Card>
      </Screen>
    );
  }

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await auth.devSignIn!(v.subject, v.email);
      analytics.track('signed_in', { reason: 'dev' });
    } catch (e) {
      setError(e);
    }
  });

  return (
    <Screen testID="dev-sign-in-screen">
      <Card tone="warning" accessibilityLabel="Development sign-in. Not for production.">
        <Row gap={8}>
          <Icon name="construct-outline" />
          <Text variant="heading">Dev sign-in</Text>
        </Row>
        <Text>
          Development only. This sends an unsigned dev:&lt;subject&gt;:&lt;email&gt; token that the API accepts only when
          WP_AUTH_MODE=dev. Production builds use Clerk.
        </Text>
        <Text variant="caption" tone="muted">
          API: {env.apiUrl}
        </Text>
      </Card>
      <TextField control={control} name="subject" label="Subject (user id)" autoCapitalize="none" />
      <TextField control={control} name="email" label="Email" autoCapitalize="none" keyboardType="email-address" />
      <FormError error={error} />
      <Button label="Sign in (dev)" onPress={onSubmit} loading={formState.isSubmitting} testID="dev-sign-in-submit" />
    </Screen>
  );
}
