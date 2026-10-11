'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { prefGet, prefSet } from './utils';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_KEY = 'wp.pref.theme';

/**
 * Runs before first paint (inline <script> with the CSP nonce) so the page never flashes the wrong theme.
 * Kept as a string because it executes outside React.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_KEY}');var d=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.dataset.theme=p||'system';}catch(e){}})();`;

const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  const p = prefGet(THEME_KEY);
  return p === 'light' || p === 'dark' ? p : 'system';
}

function apply(pref: ThemePreference) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = pref;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystem = () => {
    if (readPreference() === 'system') apply('system');
    cb();
  };
  mq.addEventListener('change', onSystem);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener('change', onSystem);
  };
}

/** Theme preference with system default; persisted as a non-financial preference. */
export function useTheme() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => 'system' as ThemePreference);
  const setPreference = useCallback((p: ThemePreference) => {
    prefSet(THEME_KEY, p === 'system' ? null : p);
    apply(p);
    listeners.forEach((l) => l());
  }, []);
  return { preference, setPreference };
}
