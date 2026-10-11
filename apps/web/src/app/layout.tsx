import '@fontsource-variable/inter';
import './globals.css';

import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { THEME_INIT_SCRIPT } from '@/lib/theme';

import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'WealthPilot', template: '%s · WealthPilot' },
  description:
    'Cross-border household wealth planning for US and India: net worth, RSUs, goals and illustrative home and retirement scenarios.',
  applicationName: 'WealthPilot',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1b2a' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading the per-request nonce makes every page dynamic, which a nonce-based CSP requires.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <a
          href="#main"
          className="sr-only z-[100] rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
          Skip to content
        </a>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
