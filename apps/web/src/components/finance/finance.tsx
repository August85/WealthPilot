'use client';

import type { FxRate, ReportingCurrency, Severity, VerificationStatus, Warning } from '@wealthpilot/contracts';
import {
  DISCLAIMER_LONG,
  DISCLAIMER_SHORT,
  dec,
  formatDate,
  formatMonthYear,
  formatNumber,
  humanizeCode,
  relativeDays,
  type RiskLevel,
} from '@wealthpilot/shared';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  CircleHelp,
  Clock,
  FlaskConical,
  GitBranch,
  Globe,
  Info,
  PencilLine,
  ShieldCheck,
  SlidersHorizontal,
  User,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Pill } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { Money } from './Money';

// ---------------------------------------------------------------------------
// ProvenancePill — verification / staleness / source, always icon + text (never colour alone)
// ---------------------------------------------------------------------------

export function ProvenancePill({
  verification,
  stale,
  asOf,
  source,
  className,
}: {
  verification?: VerificationStatus | null;
  stale?: boolean;
  asOf?: string | null;
  source?: string | null;
  className?: string;
}) {
  return (
    <span className={cn('flex flex-wrap gap-1.5', className)}>
      {verification === 'verified' ? (
        <Pill kind="ok" icon={<CheckCircle2 aria-hidden />}>
          Verified
        </Pill>
      ) : null}
      {verification === 'estimated' ? (
        <Pill kind="warn" icon={<CircleHelp aria-hidden />}>
          Estimated
        </Pill>
      ) : null}
      {stale ? (
        <Pill kind="warn" icon={<Clock aria-hidden />}>
          {asOf ? `Stale · ${formatDate(asOf)}` : 'Stale · no balance'}
        </Pill>
      ) : asOf ? (
        <Pill icon={<Calendar aria-hidden />}>As of {formatDate(asOf)}</Pill>
      ) : null}
      {source ? <Pill icon={<PencilLine aria-hidden />}>{source === 'manual' ? 'Manual' : source}</Pill> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ForecastLabels — required on every forecast card (spec §4.2)
// ---------------------------------------------------------------------------

export function ForecastLabels({
  asOf,
  scenario,
  assumptions,
  testId = 'forecast-labels',
}: {
  asOf: string | null | undefined;
  scenario: string | null | undefined;
  assumptions: string | null | undefined;
  testId?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId} aria-label="Forecast labels">
      <Pill icon={<Calendar aria-hidden />}>As of {asOf ? formatDate(asOf) : '—'}</Pill>
      <Pill icon={<GitBranch aria-hidden />}>Scenario: {scenario ?? '—'}</Pill>
      <Pill icon={<SlidersHorizontal aria-hidden />}>Assumptions: {assumptions ?? '—'}</Pill>
      <Pill kind="warn" icon={<FlaskConical aria-hidden />}>
        Illustrative
      </Pill>
    </div>
  );
}

export function ForecastCard({
  title,
  asOf,
  scenario,
  assumptions,
  children,
  action,
  testId,
  className,
}: {
  title: string;
  asOf: string | null | undefined;
  scenario: string | null | undefined;
  assumptions: string | null | undefined;
  children: ReactNode;
  action?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <Card data-testid={testId} className={className}>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          {action}
        </div>
        <ForecastLabels asOf={asOf} scenario={scenario} assumptions={assumptions} />
        {children}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// BalanceCard
// ---------------------------------------------------------------------------

export function BalanceCard({
  title,
  amount,
  currency,
  asOf,
  subtitle,
  verification,
  stale,
  size = 'xl',
  children,
  testId,
}: {
  title: string;
  amount: string | null | undefined;
  currency: string;
  asOf?: string | null;
  subtitle?: ReactNode;
  verification?: VerificationStatus | null;
  stale?: boolean;
  size?: 'xl' | 'lg' | 'md';
  children?: ReactNode;
  testId?: string;
}) {
  const unconfirmed = verification === 'estimated' || stale;
  const qualifier = [verification === 'estimated' ? 'estimated' : null, stale ? 'stale' : null].filter(Boolean).join(', ');
  return (
    <Card data-testid={testId} className={cn(unconfirmed && 'unconfirmed border-2')}>
      <CardContent>
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <Money
          value={amount}
          currency={currency}
          qualifier={qualifier || undefined}
          className={cn(
            'font-semibold tracking-tight',
            size === 'xl' ? 'text-4xl sm:text-5xl' : size === 'lg' ? 'text-3xl' : 'text-2xl',
          )}
        />
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        {verification || stale || asOf ? <ProvenancePill verification={verification} stale={stale} asOf={asOf} /> : null}
        {children}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// CurrencyToggle — changes the display/reporting currency only; never touches balances
// ---------------------------------------------------------------------------

export function CurrencyToggle({
  value,
  onChange,
  testId = 'currency-toggle',
  label = 'Reporting currency',
}: {
  value: ReportingCurrency;
  onChange: (c: ReportingCurrency) => void;
  testId?: string;
  label?: string;
}) {
  const options: ReportingCurrency[] = ['USD', 'INR'];
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      className="inline-flex rounded-full border border-border bg-muted p-0.5"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          onChange(value === 'USD' ? 'INR' : 'USD');
        }
      }}>
      {options.map((c) => {
        const selected = value === c;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-testid={`${testId}-${c}`}
            title={`${c === 'USD' ? 'Show in US dollars' : 'Show in Indian rupees'} (display only; balances are not changed)`}
            onClick={() => onChange(c)}
            className={cn(
              'h-8 min-w-16 cursor-pointer rounded-full px-3 text-sm font-medium transition-colors',
              selected ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground hover:bg-card',
            )}>
            {c === 'USD' ? '$ USD' : '₹ INR'}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssumptionRow / KeyValue
// ---------------------------------------------------------------------------

export function AssumptionRow({
  label,
  value,
  note,
  action,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 text-right text-sm font-semibold tabular">
        {value}
        {action}
      </div>
    </div>
  );
}

export function KeyValue({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1 text-sm', className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium tabular break-all">{children}</dd>
    </div>
  );
}

export function KeyValueList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('divide-y divide-border/60', className)}>{children}</dl>;
}

// ---------------------------------------------------------------------------
// WarningPanel
// ---------------------------------------------------------------------------

const SEVERITY_META: Record<Severity, { icon: typeof Info; label: string; cls: string }> = {
  critical: { icon: AlertCircle, label: 'Critical', cls: 'text-danger' },
  warning: { icon: AlertTriangle, label: 'Warning', cls: 'text-warning-strong dark:text-warning' },
  info: { icon: Info, label: 'Info', cls: 'text-info' },
};
const ORDER: Severity[] = ['critical', 'warning', 'info'];

export function WarningPanel({
  warnings,
  title = 'Warnings and caveats',
  testId = 'warning-panel',
}: {
  warnings: Warning[] | undefined | null;
  title?: string;
  testId?: string;
}) {
  if (!warnings || warnings.length === 0) return null;
  const sorted = [...warnings].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  const top = sorted[0]?.severity;
  return (
    <Card data-testid={testId} tone={top === 'critical' ? 'danger' : top === 'warning' ? 'warning' : 'info'}>
      <CardContent>
        <h2 className="text-base font-semibold">{title}</h2>
        <ul className="flex flex-col gap-3">
          {sorted.map((w, i) => {
            const meta = SEVERITY_META[w.severity] ?? SEVERITY_META.info;
            const Icon = meta.icon;
            return (
              <li key={`${w.code}-${i}`} className="flex items-start gap-2.5">
                <Icon className={cn('mt-0.5 size-4 shrink-0', meta.cls)} aria-hidden />
                <div className="min-w-0">
                  <p className={cn('text-xs font-semibold tracking-wide uppercase', meta.cls)}>
                    {meta.label} · {humanizeCode(w.code)}
                  </p>
                  <p className="text-sm">{w.message}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// RiskIndicator
// ---------------------------------------------------------------------------

export function RiskIndicator({ level, label, detail }: { level: RiskLevel; label: string; detail?: string }) {
  const meta = {
    low: { icon: ShieldCheck, text: 'Low', cls: 'text-success', bars: 1, bar: 'bg-success' },
    medium: { icon: AlertTriangle, text: 'Medium', cls: 'text-warning-strong dark:text-warning', bars: 2, bar: 'bg-warning' },
    high: { icon: AlertCircle, text: 'High', cls: 'text-danger', bars: 3, bar: 'bg-danger' },
  }[level];
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 py-2" data-testid={`risk-${label}`}>
      <Icon className={cn('size-5 shrink-0', meta.cls)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      <div className="flex items-end gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('w-1.5 rounded-sm', i <= meta.bars ? meta.bar : 'bg-border')} style={{ height: 6 + i * 4 }} />
        ))}
      </div>
      <span className={cn('w-16 text-right text-sm font-semibold', meta.cls)}>
        {meta.text}
        <span className="sr-only"> risk</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GoalProgress
// ---------------------------------------------------------------------------

export function GoalProgress({
  name,
  icon,
  pct,
  funded,
  target,
  currency,
  targetDate,
  illustrative,
  href,
}: {
  name: string;
  icon?: ReactNode;
  pct: string | null | undefined;
  funded?: string | null;
  target?: string | null;
  currency: string;
  targetDate?: string | null;
  illustrative?: boolean;
  href?: string;
}) {
  // `pct` is already a percentage 0-100 ("54.99" = 55%), like ownership_pct; the API caps it at 100. See DECISIONS.md.
  const pctNum = pct == null ? null : dec(pct);
  const shown = pctNum === null ? '—' : `${pctNum.toDecimalPlaces(0).toFixed(0)}%`;
  const width = pctNum === null ? 0 : Math.max(0, Math.min(100, pctNum.toNumber()));
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className="text-link">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {name}
          {targetDate ? <span className="font-normal text-muted-foreground"> · {formatMonthYear(targetDate)}</span> : null}
        </span>
        <span className="text-sm font-semibold tabular">
          {shown} funded{illustrative ? '*' : ''}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${name} funded`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        aria-valuetext={`${shown} funded${illustrative ? ', illustrative' : ''}`}
        className="h-2.5 overflow-hidden rounded-full border border-border bg-muted">
        <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
      </div>
      {funded && target ? (
        <p className="text-xs text-muted-foreground">
          <Money value={funded} currency={currency} compact={false} /> of <Money value={target} currency={currency} compact={false} />
        </p>
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="flex flex-col gap-1.5 rounded-lg p-2 -mx-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
        {body}
      </Link>
    );
  }
  return <div className="flex flex-col gap-1.5 py-2">{body}</div>;
}

// ---------------------------------------------------------------------------
// VestTimeline
// ---------------------------------------------------------------------------

export interface VestTimelineItem {
  id: string;
  date: string;
  title: string;
  shares: string;
  status: 'scheduled' | 'vested' | 'cancelled';
  value?: string | null;
  currency?: string;
  href?: string;
}

export function VestTimeline({ items, today }: { items: VestTimelineItem[]; today?: string }) {
  const statusMeta = {
    scheduled: { icon: Clock, label: 'Scheduled', cls: 'text-info' },
    vested: { icon: CheckCircle2, label: 'Vested', cls: 'text-success' },
    cancelled: { icon: XCircle, label: 'Cancelled', cls: 'text-muted-foreground' },
  };
  return (
    <ol className="flex flex-col">
      {items.map((it, idx) => {
        const m = statusMeta[it.status];
        const Icon = m.icon;
        const inner = (
          <>
            <div className="flex flex-col items-center">
              <Icon className={cn('size-5', m.cls)} aria-hidden />
              {idx < items.length - 1 ? <span className="my-1 w-0.5 flex-1 bg-border" aria-hidden /> : null}
            </div>
            <div className="min-w-0 flex-1 pb-4">
              <p className="text-sm font-semibold">{it.title}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(it.date)} ({relativeDays(it.date, today)}) · {m.label}
              </p>
              <p className="text-sm tabular">
                {dec(it.shares).toFixed()} shares
                {it.value && it.currency ? (
                  <>
                    {' '}
                    <span className="text-muted-foreground">· est. gross</span>{' '}
                    <Money value={it.value} currency={it.currency} qualifier="estimated gross value" />
                  </>
                ) : null}
              </p>
            </div>
          </>
        );
        return (
          <li key={it.id}>
            {it.href ? (
              <Link href={it.href} className="-mx-2 flex gap-3 rounded-lg px-2 pt-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                {inner}
              </Link>
            ) : (
              <div className="flex gap-3 pt-1">{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// FX provenance and disclaimers
// ---------------------------------------------------------------------------

/** "1 USD = 85.0000 INR · Your saved rate · As of … · Excludes fees/spread · Source" (spec §4.2). */
export function FxProvenance({ rates, testId = 'fx-provenance' }: { rates: FxRate[] | undefined; testId?: string }) {
  if (!rates || rates.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {rates.map((r) => (
        <div key={`${r.base}/${r.quote}/${r.kind}`} className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold tabular">
            1 {r.base} = {formatNumber(r.rate, { decimals: 4, grouping: 'western' })} {r.quote}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Pill kind={r.kind === 'user' ? 'neutral' : 'warn'} icon={r.kind === 'user' ? <User aria-hidden /> : <Globe aria-hidden />}>
              {r.kind === 'user' ? 'Your saved rate' : 'Reference only'}
            </Pill>
            <Pill kind={r.stale ? 'warn' : 'neutral'} icon={<Calendar aria-hidden />}>
              As of {formatDate(r.as_of)}
            </Pill>
            {r.stale ? (
              <Pill kind="warn" icon={<Clock aria-hidden />}>
                Stale rate (&gt; 7 days)
              </Pill>
            ) : null}
            <Pill icon={<Info aria-hidden />}>Excludes fees/spread</Pill>
          </div>
          <p className="text-xs text-muted-foreground">
            Source: {r.provider}
            {r.license_reference ? ` · Licence ${r.license_reference}` : ''}
          </p>
        </div>
      ))}
    </div>
  );
}

export function Disclaimer({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <aside
      aria-label="Disclaimer"
      className={cn('flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-xs text-foreground', className)}>
      <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <p>{compact ? DISCLAIMER_SHORT : DISCLAIMER_LONG}</p>
    </aside>
  );
}
