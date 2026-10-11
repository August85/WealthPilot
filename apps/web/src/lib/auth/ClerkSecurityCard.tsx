'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import { KeyRound, Settings2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Sign-in methods and passkeys (Clerk mode only; must render inside <ClerkProvider>). */
export function ClerkSecurityCard() {
  const { user } = useUser();
  const clerk = useClerk();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passkeys = user?.passkeys ?? [];
  const addPasskey = async () => {
    if (!user) return;
    setBusy(true);
    setMessage(null);
    try {
      await user.createPasskey();
      await user.reload();
      setMessage('Passkey added. You can now sign in with it.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not add a passkey.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader className="flex-col">
        <CardTitle>Sign-in methods</CardTitle>
        <CardDescription>Managed by Clerk: Google, Apple, Microsoft, email and passkeys.</CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        <p className="text-sm">
          {passkeys.length ? `${passkeys.length} passkey${passkeys.length === 1 ? '' : 's'} registered.` : 'No passkeys yet.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void addPasskey()} loading={busy}>
            <KeyRound aria-hidden /> Add a passkey
          </Button>
          <Button variant="ghost" onClick={() => clerk.openUserProfile()}>
            <Settings2 aria-hidden /> Manage sign-in methods
          </Button>
        </div>
        {message ? (
          <p role="status" className="text-xs text-muted-foreground">
            {message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
