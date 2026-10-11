import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      kind: {
        neutral: 'border-border bg-muted text-muted-foreground',
        ok: 'border-success/40 bg-success-soft text-success',
        // Estimated / stale / illustrative: dashed outline as well as colour (never colour alone).
        warn: 'border-dashed border-warning bg-warning-soft text-warning-strong dark:text-warning',
        danger: 'border-danger/50 bg-danger-soft text-danger',
        accent: 'border-accent/40 bg-accent-soft text-link',
        info: 'border-info/30 bg-info-soft text-info',
      },
    },
    defaultVariants: { kind: 'neutral' },
  },
);

export interface PillProps extends Omit<ComponentProps<'span'>, 'children'>, VariantProps<typeof badgeVariants> {
  icon?: ReactNode;
  children: ReactNode;
}

/** Status pill: always icon + text so meaning never depends on colour alone. */
export function Pill({ className, kind, icon, children, ...props }: PillProps) {
  return (
    <span className={cn(badgeVariants({ kind }), className)} {...props}>
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}
