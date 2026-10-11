import type { Metadata } from 'next';

import { AddAccountPage } from '@/features/accounts/AddAccountPage';

export const metadata: Metadata = { title: 'Add account' };

export default function Page() {
  return <AddAccountPage />;
}
