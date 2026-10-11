import type { Metadata } from 'next';

import { GrantEditorPage } from '@/features/rsu/GrantEditorPage';

export const metadata: Metadata = { title: 'RSU grant' };

export default function Page() {
  return <GrantEditorPage />;
}
