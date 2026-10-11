import type { Metadata } from 'next';

import { GrantListPage } from '@/features/rsu/GrantListPage';

export const metadata: Metadata = { title: 'RSU grants' };

export default function Page() {
  return <GrantListPage />;
}
