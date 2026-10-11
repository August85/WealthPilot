import type { Metadata } from 'next';

import { ScenariosPage } from '@/features/scenarios/ScenariosPage';

export const metadata: Metadata = { title: 'Scenarios' };

export default function Page() {
  return <ScenariosPage />;
}
