import type { Metadata } from 'next';

import { ResidencySettingsPage } from '@/features/profile/ResidencySettingsPage';

export const metadata: Metadata = { title: 'Tax residency' };

export default function Page() {
  return <ResidencySettingsPage />;
}
