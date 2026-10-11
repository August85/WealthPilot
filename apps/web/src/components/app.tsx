'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { AlertCircle, GitCompareArrows, RefreshCw, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertDialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/hooks';
import { useUiStore } from '@/lib/store';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  back,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3">
      {back ? (
        <Link href={back.href} className="w-fit text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          ← {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? <div className="mb-1 text-sm text-muted-foreground">{eyebrow}</div> : null}
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {description ? <div className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function LoadingState({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-28 w-full" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card tone="danger" role="alert" data-testid="error-state">
      <CardContent className="flex-row items-start gap-3">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="font-semibold">Something went wrong</p>
          <p className="text-sm">{message}</p>
          {onRetry ? (
            <Button variant="outline" size="sm" className="w-fit" onClick={onRetry}>
              <RefreshCw aria-hidden /> Try again
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  testId,
}: {
  icon?: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-10 text-center">
      {Icon ? (
        <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-link">
          <Icon className="size-6" aria-hidden />
        </span>
      ) : null}
      <h2 className="text-base font-semibold">{title}</h2>
      {body ? <div className="max-w-md text-sm text-muted-foreground">{body}</div> : null}
      {action}
    </div>
  );
}

/** Render helper for a query: skeleton, error (with retry) or the content. Cached data shows even when a refetch fails. */
export function QueryView<T>({
  query,
  children,
  loadingLabel,
  rows,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  loadingLabel?: string;
  rows?: number;
}) {
  if (query.data !== undefined) {
    return (
      <>
        {query.isError ? (
          <p role="alert" className="mb-3 flex items-center gap-1.5 text-xs font-medium text-warning-strong dark:text-warning">
            <AlertCircle className="size-3.5" aria-hidden /> Showing the last loaded data. Refresh failed: {errorMessage(query.error)}
          </p>
        ) : null}
        {children(query.data)}
      </>
    );
  }
  if (query.isError) return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  return <LoadingState label={loadingLabel} rows={rows} />;
}

export function FormError({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  return (
    <div role="alert" className={cn('flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger', className)}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{errorMessage(error)}</span>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Version-conflict resolve prompt (409 VERSION_CONFLICT). Never last-write-wins. */
export function ConflictDialog() {
  const conflict = useUiStore((s) => s.conflict);
  const dismiss = useUiStore((s) => s.dismissConflict);
  return (
    <AlertDialog
      open={!!conflict}
      onOpenChange={(o) => {
        if (!o) dismiss();
      }}
      testId="conflict-dialog"
      title="This changed somewhere else"
      description={
        conflict
          ? `${capitalize(conflict.entity)} was updated on another device or session after you opened it. Your changes were not saved, and nothing was overwritten.`
          : undefined
      }
      actions={
        <>
          <Button variant="outline" data-testid="conflict-keep" onClick={dismiss}>
            Keep my edits on screen
          </Button>
          <Button
            data-testid="conflict-reload"
            onClick={async () => {
              const c = conflict;
              dismiss();
              await c?.onReload();
            }}>
            <RefreshCw aria-hidden /> Load latest version
          </Button>
        </>
      }>
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <GitCompareArrows className="mt-0.5 size-4 shrink-0 text-warning-strong dark:text-warning" aria-hidden />
        <div className="flex flex-col gap-1">
          {conflict?.detail ? <p>{conflict.detail}</p> : null}
          <p>Load the latest version, review it, then re-apply your edit if it still makes sense.</p>
        </div>
      </div>
    </AlertDialog>
  );
}

/** A navigable row: icon, title/subtitle and optional trailing content. */
export function LinkRow({
  href,
  icon: Icon,
  title,
  subtitle,
  right,
  testId,
}: {
  href: string;
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  testId?: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
      {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
      </span>
      {right}
    </Link>
  );
}

/** Small "Section" heading used inside pages. */
export function Section({ title, description, actions, children, className, testId }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)} data-testid={testId}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
