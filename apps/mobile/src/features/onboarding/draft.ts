import { create } from 'zustand';

import type { ResidencyFormOutput } from './ResidencyForm';

/** Ephemeral onboarding draft carried from S03 to S04; cleared after submission. */
interface DraftState {
  residency: ResidencyFormOutput | null;
  setResidency: (r: ResidencyFormOutput) => void;
  clear: () => void;
}

export const useOnboardingDraft = create<DraftState>((set) => ({
  residency: null,
  setResidency: (residency) => set({ residency }),
  clear: () => set({ residency: null }),
}));
