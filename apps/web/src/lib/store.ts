/**
 * Ephemeral UI state only. No financial data lives here (server data belongs to TanStack Query, in memory).
 * The only persisted bits are non-financial viewer preferences (short amounts) in localStorage.
 */
import type { ReportingCurrency } from '@wealthpilot/contracts';
import { create } from 'zustand';

import { prefGet, prefSet } from './utils';

export interface ConflictPrompt {
  /** What was being saved, e.g. "this account". */
  entity: string;
  detail?: string;
  /** Reload the latest server copy (discarding local edits). */
  onReload: () => void | Promise<void>;
}

interface UiState {
  /** Display currency override for this tab. `null` = the profile's reporting currency. */
  displayCurrency: ReportingCurrency | null;
  /** Show lakh/crore (INR) or K/M (USD) approximations alongside full amounts. */
  compactAmounts: boolean;
  conflict: ConflictPrompt | null;
  /** Mobile navigation drawer. */
  navOpen: boolean;
  setDisplayCurrency: (c: ReportingCurrency | null) => void;
  setCompactAmounts: (v: boolean) => void;
  showConflict: (c: ConflictPrompt) => void;
  dismissConflict: () => void;
  setNavOpen: (v: boolean) => void;
  reset: () => void;
}

const COMPACT_KEY = 'wp.pref.compactAmounts';

export const useUiStore = create<UiState>((set) => ({
  displayCurrency: null,
  compactAmounts: false,
  conflict: null,
  navOpen: false,
  setDisplayCurrency: (displayCurrency) => set({ displayCurrency }),
  setCompactAmounts: (compactAmounts) => {
    prefSet(COMPACT_KEY, compactAmounts ? '1' : null);
    set({ compactAmounts });
  },
  showConflict: (conflict) => set({ conflict }),
  dismissConflict: () => set({ conflict: null }),
  setNavOpen: (navOpen) => set({ navOpen }),
  reset: () => set({ displayCurrency: null, conflict: null, navOpen: false }),
}));

/** Load persisted viewer preferences after hydration (never during render, to avoid hydration mismatches). */
export function hydrateUiPreferences() {
  if (prefGet(COMPACT_KEY) === '1') useUiStore.setState({ compactAmounts: true });
}
