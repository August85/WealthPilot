import type { Metadata } from 'next';

import { SecurityPage } from '@/features/profile/SecurityPage';

export const metadata: Metadata = { title: 'Privacy & security' };

export default function Page() {
  return <SecurityPage />;
}
