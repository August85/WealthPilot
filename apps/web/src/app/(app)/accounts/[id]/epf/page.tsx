import type { Metadata } from 'next';

import { EpfEditorPage } from '@/features/accounts/EpfEditorPage';

export const metadata: Metadata = { title: 'EPF details' };

export default function Page() {
  return <EpfEditorPage />;
}
