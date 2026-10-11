'use client';

import { PLAN_LABELS } from '@wealthpilot/shared';
import {
  ArrowLeftRight,
  Bell,
  BookOpen,
  Crown,
  Download,
  GitCompareArrows,
  Home,
  Lightbulb,
  LogOut,
  Menu,
  PieChart,
  Settings,
  Sunset,
  Target,
  TrendingUp,
  Wallet,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';

import { useAuthSession } from '@/lib/auth/context';
import { useInbox, useMe } from '@/lib/hooks';
import { useUiStore } from '@/lib/store';
import { cn } from '@/lib/utils';

import { Brand } from './Brand';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Extra path prefixes that also mark this item active. */
  match?: string[];
  exact?: boolean;
}

const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Household',
    items: [
      { href: '/overview', label: 'Overview', icon: PieChart },
      { href: '/accounts', label: 'Accounts', icon: Wallet },
      { href: '/rsu', label: 'RSU grants', icon: TrendingUp, exact: false },
      { href: '/goals', label: 'Goals', icon: Target },
      { href: '/fx', label: 'FX assumptions', icon: ArrowLeftRight },
    ],
  },
  {
    title: 'Plan',
    items: [
      { href: '/plan/home', label: 'Home planner', icon: Home },
      { href: '/plan/retirement', label: 'Retirement planner', icon: Sunset },
      { href: '/scenarios', label: 'Scenarios', icon: Workflow, match: ['/runs'] },
      { href: '/scenarios/compare', label: 'Compare', icon: GitCompareArrows, exact: true },
      { href: '/insights', label: 'Insights', icon: Lightbulb },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/notifications', label: 'Notifications', icon: Bell },
      { href: '/export', label: 'Export', icon: Download },
      { href: '/settings', label: 'Settings', icon: Settings },
      { href: '/subscription', label: 'Subscription', icon: Crown },
      { href: '/help', label: 'Help & disclosures', icon: BookOpen },
    ],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  if (item.href === '/scenarios' && pathname.startsWith('/scenarios/compare')) return false;
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function NavLinks({ onNavigate, unread }: { onNavigate?: () => void; unread: number }) {
  const pathname = usePathname() ?? '';
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {NAV.map((group) => (
        <div key={group.title} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">{group.title}</p>
          {group.items.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                data-testid={`nav-${item.href.slice(1).replace(/\//g, '-')}`}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-sidebar-accent',
                  active ? 'bg-sidebar-active text-white' : 'text-sidebar-foreground/85 hover:bg-sidebar-active/60 hover:text-white',
                )}>
                <Icon
                  className={cn('size-4 shrink-0', active ? 'text-sidebar-accent' : 'text-sidebar-muted group-hover:text-sidebar-foreground')}
                  aria-hidden
                />
                <span className="flex-1">{item.label}</span>
                {item.href === '/notifications' && unread > 0 ? (
                  <span className="rounded-full bg-sidebar-accent px-1.5 text-[11px] font-semibold text-navy tabular">
                    {unread}
                    <span className="sr-only"> unread</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  const auth = useAuthSession();
  const me = useMe();
  return (
    <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <ThemeToggle tone="sidebar" />
        {me.data ? (
          <Link href="/subscription" className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-sidebar-foreground hover:bg-white/5">
            {PLAN_LABELS[me.data.entitlement] ?? me.data.entitlement} plan
          </Link>
        ) : null}
      </div>
      <div className="flex items-center gap-2 px-1">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-active text-xs font-semibold text-sidebar-accent uppercase"
          aria-hidden>
          {(me.data?.display_name ?? me.data?.email ?? auth.label ?? '?').slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{me.data?.display_name ?? 'Signed in'}</p>
          <p className="truncate text-xs text-sidebar-muted">{me.data?.email ?? auth.label ?? ''}</p>
        </div>
        <button
          type="button"
          onClick={() => void auth.signOut()}
          data-testid="sign-out"
          title="Sign out"
          className="flex size-8 cursor-pointer items-center justify-center rounded-md text-sidebar-muted hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-sidebar-accent">
          <LogOut className="size-4" aria-hidden />
          <span className="sr-only">Sign out</span>
        </button>
      </div>
      {auth.mode === 'dev' ? (
        <p className="rounded-md border border-dashed border-amber-400/60 px-2 py-1 text-[11px] text-amber-200">Dev sign-in (local development only)</p>
      ) : null}
    </div>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const inbox = useInbox();
  const unread = inbox.data?.items.filter((n) => !n.read_at).length ?? 0;
  return (
    <div className="flex h-full flex-col gap-6 px-3 py-5">
      <Link href="/overview" onClick={onNavigate} className="px-2 focus-visible:outline-2 focus-visible:outline-sidebar-accent">
        <Brand tone="dark" />
      </Link>
      <div className="flex-1 overflow-y-auto">
        <NavLinks onNavigate={onNavigate} unread={unread} />
      </div>
      <SidebarFooter />
    </div>
  );
}

/** Desktop-first layout: sticky full-height sidebar ≥ lg, slide-in drawer (focus-trapped dialog) below. */
export function AppShell({ children }: { children: ReactNode }) {
  const navOpen = useUiStore((s) => s.navOpen);
  const setNavOpen = useUiStore((s) => s.setNavOpen);
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 z-30 hidden h-dvh w-64 shrink-0 bg-sidebar text-sidebar-foreground lg:block" aria-label="Sidebar">
        <SidebarBody />
      </aside>

      <DialogPrimitive.Root open={navOpen} onOpenChange={setNavOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-navy/60 lg:hidden" />
          <DialogPrimitive.Content
            className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-sidebar text-sidebar-foreground shadow-xl lg:hidden"
            aria-describedby={undefined}>
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="absolute top-4 right-3 flex size-9 cursor-pointer items-center justify-center rounded-md text-sidebar-muted hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-sidebar-accent"
              data-testid="nav-close">
              <X className="size-5" aria-hidden />
              <span className="sr-only">Close navigation</span>
            </DialogPrimitive.Close>
            <SidebarBody onNavigate={() => setNavOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            data-testid="nav-open"
            className="-ml-1 flex size-10 cursor-pointer items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            <Menu className="size-5" aria-hidden />
            <span className="sr-only">Open navigation</span>
          </button>
          <Link href="/overview" className="focus-visible:outline-2 focus-visible:outline-ring">
            <Brand tone="light" compact />
          </Link>
          <div className="ml-auto">
            <Link
              href="/notifications"
              className="flex size-10 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="Notifications">
              <Bell className="size-5" aria-hidden />
            </Link>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-6 focus:outline-none sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
