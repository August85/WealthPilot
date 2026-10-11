import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} {...props} />;
}

export function Separator({ className, ...props }: ComponentProps<'hr'>) {
  return <hr className={cn('border-0 border-t border-border', className)} {...props} />;
}

/** Visually hidden but announced by screen readers. */
export function SrOnly({ children }: { children: React.ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
