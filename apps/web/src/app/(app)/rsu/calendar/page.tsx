import type { Metadata } from 'next';

import { VestCalendarPage } from '@/features/rsu/VestCalendarPage';

export const metadata: Metadata = { title: 'Vest calendar' };

export default function Page() {
  return <VestCalendarPage />;
}
