import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { useUiStore } from '@/lib/store';

/** Controllable stand-in for next/navigation (tests set params/search and assert on router calls). */
export const nav = {
  params: {} as Record<string, string>,
  search: new URLSearchParams(),
  pathname: '/',
  router: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  },
};

vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.search,
  useParams: () => nav.params,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// Recharts' ResponsiveContainer needs ResizeObserver; jsdom does not provide one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver ??= ResizeObserverStub;

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
  nav.params = {};
  nav.search = new URLSearchParams();
  nav.pathname = '/';
  Object.values(nav.router).forEach((fn) => fn.mockClear());
  useUiStore.setState({ displayCurrency: null, compactAmounts: false, conflict: null, navOpen: false });
});
