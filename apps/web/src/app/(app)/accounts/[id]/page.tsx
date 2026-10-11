import type { Metadata } from 'next';

import { AccountDetailPage } from '@/features/accounts/AccountDetailPage';

export const metadata: Metadata = { title: 'Account' };

export default function Page() {
  return <AccountDetailPage />;
}
