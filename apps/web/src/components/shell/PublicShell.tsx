'use client';

import { DISCLAIMER_SHORT } from '@wealthpilot/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useAuthSession } from '@/lib/auth/context';

import { Brand } from './Brand';
import { ThemeToggle } from './ThemeToggle';

/** Header/footer for public pages (landing, sign-in/up, help). */
export function PublicShell({ children }: { children: ReactNode }) {
  const auth = useAuthSession();
  const signedIn = auth.status === 'signedIn';
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="focus-visible:outline-2 focus-visible:outline-ring">
            <Brand />
          </Link>
          <nav aria-label="Site" className="ml-auto flex items-center gap-1 sm:gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/help">Help &amp; disclosures</Link>
            </Button>
            <ThemeToggle className="hidden sm:inline-flex" />
            {signedIn ? (
              <Button asChild size="sm">
                <Link href="/overview">Open app</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="outline" size="sm">
                  <Link href="/sign-in" data-testid="header-sign-in">
                    Sign in
                  </Link>
                </Button>
                {auth.mode === 'clerk' ? (
                  <Button asChild size="sm" className="hidden sm:inline-flex">
                    <Link href="/sign-up">Create account</Link>
                  </Button>
                ) : null}
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>{DISCLAIMER_SHORT}</p>
          <nav aria-label="Footer" className="flex gap-4">
            <Link href="/help" className="hover:text-foreground hover:underline">
              Help &amp; disclosures
            </Link>
            <Link href="/sign-in" className="hover:text-foreground hover:underline">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
