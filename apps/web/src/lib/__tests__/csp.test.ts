import { describe, expect, it } from 'vitest';

import { buildCsp } from '../csp';

const PK = 'pk_test_bWFnaWNhbC1jb3JhbC00MjA5LmNsZXJrLmFjY291bnRzLmRldiQ';
const API = 'https://api.example.test/v1';

function connectSrc(csp: string): string[] {
  const directive = csp.split('; ').find((d) => d.startsWith('connect-src '));
  return directive ? directive.split(' ').slice(1) : [];
}

describe('buildCsp', () => {
  it('allows the Clerk Frontend API, telemetry and bot protection when Clerk is configured', () => {
    const csp = buildCsp({ nonce: 'n', apiUrl: API, clerkPublishableKey: PK, dev: false });
    expect(connectSrc(csp)).toEqual([
      "'self'",
      'https://api.example.test',
      'https://magical-coral-4209.clerk.accounts.dev',
      'https://clerk-telemetry.com',
      'https://*.protect.clerk.com:*',
    ]);
  });

  it('allows no Clerk hosts without a publishable key', () => {
    const csp = buildCsp({ nonce: 'n', apiUrl: API, clerkPublishableKey: undefined, dev: false });
    expect(connectSrc(csp)).toEqual(["'self'", 'https://api.example.test']);
  });
});
