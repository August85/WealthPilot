/**
 * Ephemeral UI state only (spec §8.1). Nothing here is persisted and no financial data lives here:
 * server data belongs to TanStack Query.
 */
import { create } from 'zustand';

import type { ReportingCurrency } from '@wealthpilot/contracts';

export interface ConflictPrompt {
  /** What was being saved, e.g. "this account". */
  entity: string;
  detail?: string;
  /** Reload the latest server copy (discarding local edits). */
  onReload: () => void | Promise<void>;
}

interface UiState {
  /** Display currency override for the session. `null` = the profile's reporting currency. */
  displayCurrency: ReportingCurrency | null;
  /** Show lakh/crore (INR) or K/M (USD) approximations alongside full amounts. */
  compactAmounts: boolean;
  conflict: ConflictPrompt | null;
  /** Unlocked by biometrics for this foreground session. */
  unlocked: boolean;
  setDisplayCurrency: (c: ReportingCurrency | null) => void;
  setCompactAmounts: (v: boolean) => void;
  showConflict: (c: ConflictPrompt) => void;
  dismissConflict: () => void;
  setUnlocked: (v: boolean) => void;
  reset: () => void;
}

const initial = {
  displayCurrency: null,
  compactAmounts: false,
  conflict: null,
  unlocked: false,
};

export const useUiStore = create<UiState>((set) => ({
  ...initial,
  setDisplayCurrency: (displayCurrency) => set({ displayCurrency }),
  setCompactAmounts: (compactAmounts) => set({ compactAmounts }),
  showConflict: (conflict) => set({ conflict }),
  dismissConflict: () => set({ conflict: null }),
  setUnlocked: (unlocked) => set({ unlocked }),
  reset: () => set(initial),
}));
