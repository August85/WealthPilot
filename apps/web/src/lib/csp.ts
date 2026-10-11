/**
 * Content-Security-Policy with a per-request nonce (set by `src/proxy.ts`). Scripts must carry the nonce
 * ('strict-dynamic' lets them load their own chunks); styles allow inline because React/Radix/Recharts set
 * style attributes. Connections are limited to this origin, the WealthPilot API and, when configured, Clerk
 * (its Frontend API, telemetry, and bot protection, which probes *.client.protect.clerk.com on several ports).
 */

export interface CspOptions {
  nonce: string;
  apiUrl: string | undefined;
  clerkPublishableKey: string | undefined;
  dev: boolean;
}

/** Origin of a URL, or null if it cannot be parsed. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Clerk publishable keys encode the Frontend API host: pk_test_<base64("host$")>. */
export function clerkFrontendApiHost(publishableKey: string | undefined): string | null {
  if (!publishableKey) return null;
  const encoded = publishableKey.split('_')[2];
  if (!encoded) return null;
  try {
    const decoded = atob(encoded).replace(/\$$/, '');
    return /^[a-z0-9.-]+$/i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function buildCsp({ nonce, apiUrl, clerkPublishableKey, dev }: CspOptions): string {
  const api = originOf(apiUrl);
  const clerkHost = clerkFrontendApiHost(clerkPublishableKey);
  const clerk = clerkHost ? `https://${clerkHost}` : null;
  const clerkServices = clerk && 'https://clerk-telemetry.com https://*.protect.clerk.com:*';
  const list = (...xs: (string | null | false)[]) => xs.filter(Boolean).join(' ');

  const directives: Record<string, string> = {
    'default-src': "'self'",
    'script-src': list("'self'", `'nonce-${nonce}'`, "'strict-dynamic'", dev && "'unsafe-eval'", clerk),
    'style-src': "'self' 'unsafe-inline'",
    'img-src': list("'self'", 'data:', 'blob:', clerk && 'https://img.clerk.com'),
    'font-src': "'self' data:",
    'connect-src': list("'self'", api, clerk, clerkServices, dev && 'ws:'),
    'frame-src': list("'self'", clerk && 'https://challenges.cloudflare.com', clerk),
    'worker-src': "'self' blob:",
    'manifest-src': "'self'",
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': list("'self'", clerk),
    'frame-ancestors': "'none'",
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v}`);
  // Only when the API itself is HTTPS (a local http://localhost API would otherwise be upgraded and fail).
  if (!dev && api?.startsWith('https:')) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

/** 128-bit random nonce, base64-encoded (Web Crypto; works in the proxy runtime and in tests). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
