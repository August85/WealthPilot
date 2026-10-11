import type { Metadata } from 'next';

import { FxPage } from '@/features/fx/FxPage';

export const metadata: Metadata = { title: 'FX assumptions' };

export default function Page() {
  return <FxPage />;
}
