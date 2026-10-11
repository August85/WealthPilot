import type { Metadata } from 'next';

import { NotificationsPage } from '@/features/profile/NotificationsPage';

export const metadata: Metadata = { title: 'Notifications' };

export default function Page() {
  return <NotificationsPage />;
}
