import { cn } from '@/lib/utils';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-8 shrink-0', className)} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#0D1B2A" />
      <path d="M14 44 L26 28 L36 36 L50 18" fill="none" stroke="#2DD4BF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="50" cy="18" r="5" fill="#D97706" />
    </svg>
  );
}

/** Logo + wordmark. `tone="dark"` is for the navy sidebar. */
export function Brand({ tone = 'light', compact }: { tone?: 'light' | 'dark'; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark className={cn(tone === 'dark' && 'ring-1 ring-white/10 rounded-[10px]')} />
      <span className={cn('font-semibold tracking-tight', compact ? 'text-base' : 'text-lg', tone === 'dark' ? 'text-white' : 'text-foreground')}>
        WealthPilot
      </span>
    </span>
  );
}
