import { z } from 'zod';

/** Validate dev-mode identity pieces; the token format is `dev:<subject>:<email>` (API WP_AUTH_MODE=dev only). */
export function buildDevToken(subject: string, email: string): string | null {
  const s = subject.trim();
  const e = email.trim().toLowerCase();
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(s)) return null;
  if (!/^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(e)) return null;
  return `dev:${s}:${e}`;
}

export const devSignInSchema = z.object({
  subject: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{1,64}$/, 'Letters, numbers, dot, dash or underscore'),
  email: z.string().trim().email('Enter a valid email'),
});
