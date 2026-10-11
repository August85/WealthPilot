import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export const inputClass =
  'flex h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(inputClass, 'h-auto min-h-20 resize-y', className)} {...props} />;
}

/** Native select (best keyboard/screen-reader support), styled like the inputs. */
export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cn(inputClass, 'cursor-pointer appearance-auto pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium text-foreground', className)} {...props} />;
}
