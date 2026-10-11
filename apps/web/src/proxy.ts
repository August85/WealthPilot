/**
 * Request proxy (Next.js 16's renamed middleware):
 * - sets a per-request nonce Content-Security-Policy (see lib/csp.ts), and
 * - when Clerk is configured, protects every app route with Clerk (public: landing, sign-in/up, help).
 *
 * With no Clerk publishable key there is no server-side session; dev sign-in (local development only) guards
 * routes client-side and the API rejects requests without a valid bearer token anyway.
 */
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

import { buildCsp, generateNonce } from './lib/csp';

const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || undefined;

const isPublicRoute = createRouteMatcher(['/', '/sign-in(.*)', '/sign-up(.*)', '/help', '/robots.txt', '/icon.svg']);

function withCsp(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    clerkPublishableKey: clerkKey,
    dev: process.env.NODE_ENV === 'development',
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

const withClerk = clerkKey
  ? clerkMiddleware(async (auth, request) => {
      if (!isPublicRoute(request)) await auth.protect();
      return withCsp(request);
    })
  : null;

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (withClerk) return withClerk(request, event);
  return withCsp(request);
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|css|js|map|txt)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
