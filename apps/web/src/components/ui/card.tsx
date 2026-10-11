import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const cardVariants = cva('rounded-xl border bg-card text-card-foreground shadow-card', {
  variants: {
    tone: {
      default: 'border-border',
      info: 'border-info/30 bg-info-soft',
      warning: 'border-warning/40 bg-warning-soft',
      danger: 'border-danger/40 bg-danger-soft',
      success: 'border-success/40 bg-success-soft',
      muted: 'border-border bg-muted shadow-none',
    },
  },
  defaultVariants: { tone: 'default' },
});

export interface CardProps extends ComponentProps<'section'>, VariantProps<typeof cardVariants> {}

export function Card({ className, tone, ...props }: CardProps) {
  return <section className={cn(cardVariants({ tone }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-wrap items-start gap-x-3 gap-y-1 px-5 pt-5 sm:px-6', className)} {...props} />;
}

export function CardTitle({ className, as: As = 'h2', ...props }: ComponentProps<'h2'> & { as?: 'h2' | 'h3' }) {
  return <As className={cn('text-base font-semibold leading-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-3 px-5 py-5 sm:px-6', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-wrap items-center gap-2 border-t px-5 py-3 sm:px-6', className)} {...props} />;
}
