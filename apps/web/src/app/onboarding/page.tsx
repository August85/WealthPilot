import type { Metadata } from 'next';

import { RequireSession } from '@/components/shell/Guards';
import { OnboardingPage } from '@/features/onboarding/OnboardingPage';

export const metadata: Metadata = { title: 'Set up' };

export default function Page() {
  return (
    <RequireSession want="onboarding">
      <OnboardingPage />
    </RequireSession>
  );
}
