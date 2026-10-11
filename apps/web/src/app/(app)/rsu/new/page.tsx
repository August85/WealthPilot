import type { Metadata } from 'next';

import { NewGrantPage } from '@/features/rsu/NewGrantPage';

export const metadata: Metadata = { title: 'New RSU grant' };

export default function Page() {
  return <NewGrantPage />;
}
