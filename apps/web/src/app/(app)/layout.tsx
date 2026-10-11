import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/AppShell';
import { RequireSession } from '@/components/shell/Guards';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireSession want="app">
      <AppShell>{children}</AppShell>
    </RequireSession>
  );
}
