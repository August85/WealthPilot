import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Read sessionStorage safely (private mode, blocked storage and SSR all return null). */
export function sessionGet(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function sessionSet(key: string, value: string | null) {
  try {
    if (typeof window === 'undefined') return;
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // storage unavailable: the session simply does not survive a reload
  }
}

/** localStorage for non-financial per-viewer preferences only (theme, short amounts). */
export function prefGet(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function prefSet(key: string, value: string | null) {
  try {
    if (typeof window === 'undefined') return;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
