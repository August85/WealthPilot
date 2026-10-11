'use client';

import { SignIn, SignUp } from '@clerk/nextjs';
import { zodResolver } from '@hookform/resolvers/zod';
import { analytics, devSignInSchema } from '@wealthpilot/shared';
import { AlertTriangle, LogIn, Wrench } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { FormError } from '@/components/app';
import { TextField } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthSession } from '@/lib/auth/context';
import { env } from '@/lib/env';

/** Only same-site relative paths are accepted as post-sign-in destinations (no open redirects). */
export function safeRedirect(raw: string | null | undefined, fallback = '/overview'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (raw.startsWith('/sign-in') || raw.startsWith('/sign-up')) return fallback;
  return raw;
}

/** S02 sign-in / sign-up. Clerk when configured; otherwise a clearly labelled local dev sign-in. */
export function AuthPage({ kind }: { kind: 'sign-in' | 'sign-up' }) {
  const auth = useAuthSession();
  const router = useRouter();
  const search = useSearchParams();
  const redirectTo = safeRedirect(search?.get('redirect_url'));

  useEffect(() => {
    if (auth.mode !== 'clerk' && auth.status === 'signedIn') router.replace(redirectTo);
  }, [auth.mode, auth.status, redirectTo, router]);

  if (auth.mode === 'clerk') {
    return (
      <div className="flex justify-center">
        {kind === 'sign-in' ? (
          <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl={redirectTo} />
        ) : (
          <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/onboarding" />
        )}
      </div>
    );
  }
  if (auth.mode === 'dev') return <DevSignIn />;
  return (
    <Card tone="warning" data-testid="auth-unconfigured" className="mx-auto max-w-lg">
      <CardHeader className="flex-col">
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-warning-strong dark:text-warning" aria-hidden /> Sign-in is not configured
        </CardTitle>
        <CardDescription className="text-foreground">
          Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (and CLERK_SECRET_KEY) for Clerk, or NEXT_PUBLIC_DEV_AUTH=1 for local development against a dev API. See
          apps/web/.env.example.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function DevSignIn() {
  const auth = useAuthSession();
  const [error, setError] = useState<unknown>(null);
  const { control, handleSubmit, formState } = useForm<z.infer<typeof devSignInSchema>>({
    resolver: zodResolver(devSignInSchema),
    defaultValues: { subject: 'demo', email: 'demo@example.test' },
  });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      if (!auth.devSignIn) throw new Error('Dev sign-in is unavailable');
      await auth.devSignIn(v.subject, v.email);
      analytics.track('signed_in', { reason: 'dev' });
    } catch (e) {
      setError(e);
    }
  });
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4" data-testid="dev-sign-in-screen">
      <Card tone="warning">
        <CardContent className="gap-2">
          <p className="flex items-center gap-2 font-semibold">
            <Wrench className="size-4" aria-hidden /> Dev sign-in · local development only
          </p>
          <p className="text-sm">
            Sends an unsigned <code className="font-mono">dev:&lt;subject&gt;:&lt;email&gt;</code> token that the API accepts only when WP_AUTH_MODE=dev. Production uses
            Clerk. The token is kept in this tab’s session storage only.
          </p>
          <p className="text-xs text-muted-foreground">API: {env.apiUrl}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
            <TextField control={control} name="subject" label="Subject (user id)" autoComplete="username" />
            <TextField control={control} name="email" label="Email" type="email" inputMode="email" autoComplete="email" />
            <FormError error={error} />
            <Button type="submit" loading={formState.isSubmitting} data-testid="dev-sign-in-submit">
              <LogIn aria-hidden /> Sign in (dev)
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
