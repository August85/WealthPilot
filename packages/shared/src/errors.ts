import { isApiError } from '@wealthpilot/contracts';

/** Human-readable message for an error from the API layer. */
export function errorMessage(e: unknown): string {
  if (!e) return '';
  if (isApiError(e)) {
    if (e.isPlanLimit) return `Your plan limit was reached${e.detail ? ` (${e.detail})` : ''}. See Subscription to upgrade.`;
    if (e.isVersionConflict) return 'Someone (or another device) changed this since you opened it.';
    if (e.isValidation && e.fieldErrors.length) {
      return e.fieldErrors.map((f) => `${f.loc.filter((l) => l !== 'body').join('.')}: ${f.msg}`).join('\n');
    }
    if (e.isNotFound) return 'Not found. It may have been deleted.';
    return e.detail || e.title || `Request failed (${e.status})`;
  }
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

/** "STALE_BALANCE" → "Stale balance". */
export function humanizeCode(code: string): string {
  const s = code.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
