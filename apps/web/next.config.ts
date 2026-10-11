import path from 'node:path';

import type { NextConfig } from 'next';

/** Monorepo root: workspace packages are TypeScript sources and node_modules are hoisted there (.npmrc). */
const monorepoRoot = path.resolve(process.cwd(), '../..');

/**
 * Static security headers for every response. The Content-Security-Policy carries a per-request nonce, so it
 * is set in `src/proxy.ts` instead.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    // Passkeys (WebAuthn) stay available to this origin; everything sensitive is off.
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=(), publickey-credentials-get=(self), publickey-credentials-create=(self)',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const config: NextConfig = {
  reactStrictMode: true,
  // Same as the Expo app: the React Compiler is on. Never write `x!.y` inside callbacks (it gets hoisted into render).
  reactCompiler: true,
  poweredByHeader: false,
  transpilePackages: ['@wealthpilot/contracts', '@wealthpilot/shared'],
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
