'use client';

import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'Use system theme', icon: Monitor },
];

export function ThemeToggle({ className, tone = 'default' }: { className?: string; tone?: 'default' | 'sidebar' }) {
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        'inline-flex rounded-lg border p-0.5',
        tone === 'sidebar' ? 'border-white/10 bg-white/5' : 'border-border bg-muted',
        className,
      )}>
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const selected = preference === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.label}
            title={o.label}
            data-testid={`theme-${o.value}`}
            onClick={() => setPreference(o.value)}
            className={cn(
              'flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              tone === 'sidebar'
                ? selected
                  ? 'bg-sidebar-active text-sidebar-accent'
                  : 'text-sidebar-muted hover:text-sidebar-foreground'
                : selected
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
            )}>
            <Icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
