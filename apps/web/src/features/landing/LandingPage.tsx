'use client';

import { DISCLAIMER_LONG } from '@wealthpilot/shared';
import { ArrowRight, CalendarClock, Fingerprint, GitCompareArrows, Globe2, Home, Lock, ShieldCheck, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { useAuthSession } from '@/lib/auth/context';

const VALUE_PROPS = [
  { icon: Globe2, title: 'One balance sheet, two countries', body: 'Bank accounts, 401(k), IRAs, EPF, PPF, FDs, property and debts in USD and INR — converted with the FX rate you choose.' },
  { icon: TrendingUp, title: 'RSUs done carefully', body: 'Grants, vest schedules, sell-to-cover and sales. Vested and unvested shares are never mixed, and nothing is double counted.' },
  { icon: Home, title: 'Home and retirement scenarios', body: 'P&I vs all-in housing cost, cash to close, deficit years, nominal and real — every number traceable to its formula.' },
  { icon: GitCompareArrows, title: 'Compare what happens next', body: 'Versioned, reproducible scenarios with presets. Overlay up to four runs and see exactly which assumptions differ.' },
  { icon: CalendarClock, title: 'Stays in sync with your phone', body: 'The same account as the mobile app. Changes on one device appear on the other, and conflicting edits are never silently overwritten.' },
  { icon: Lock, title: 'Private by design', body: 'Manual entry, no bank logins. No financial data stored in your browser. Analytics never see amounts or personal details.' },
];

/** S01 marketing landing page. */
export function LandingPage() {
  const auth = useAuthSession();
  const signedIn = auth.status === 'signedIn';
  return (
    <div data-testid="landing">
      <section className="relative overflow-hidden bg-navy text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(45,212,191,0.25),transparent_55%)]" />
        <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="flex flex-col gap-6">
            <p className="w-fit rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-teal-200">For households with money in the US and India</p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">See what you own across borders. Plan what comes next.</h1>
            <p className="max-w-xl text-lg text-slate-300">
              WealthPilot brings your US and Indian accounts, RSUs and debts into one honest picture, then lets you test home and retirement plans with
              assumptions you can see and change.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-teal-400 text-navy hover:bg-teal-300">
                <Link href={signedIn ? '/overview' : auth.mode === 'clerk' ? '/sign-up' : '/sign-in'} data-testid="get-started">
                  {signedIn ? 'Open WealthPilot' : 'Get started'} <ArrowRight aria-hidden />
                </Link>
              </Button>
              {!signedIn ? (
                <Button asChild size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10">
                  <Link href="/sign-in">I already have an account</Link>
                </Button>
              ) : null}
            </div>
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="size-4" aria-hidden /> Illustrative planning only — not tax, legal or investment advice.
            </p>
          </div>
          <HeroPreview />
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="value-heading">
        <h2 id="value-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Built for cross-border complexity
        </h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">Clear provenance on every number: as-of dates, verified vs estimated, your FX rate, and the assumptions behind every forecast.</p>
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {VALUE_PROPS.map((v) => {
            const Icon = v.icon;
            return (
              <li key={v.title} className="flex flex-col gap-3 rounded-xl border bg-card p-6 shadow-card">
                <span className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-link">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="font-semibold">{v.title}</h3>
                <p className="text-sm text-muted-foreground">{v.body}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-12 sm:px-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Fingerprint className="size-5 text-muted-foreground" aria-hidden /> Important disclosure
          </h2>
          <p className="max-w-4xl text-sm text-muted-foreground">{DISCLAIMER_LONG}</p>
          <Link href="/help" className="w-fit text-sm font-medium text-link hover:underline">
            Read the full help &amp; disclosures
          </Link>
        </div>
      </section>
    </div>
  );
}

/** Static, clearly fictional product preview (no real data). */
function HeroPreview() {
  return (
    <div aria-hidden className="hidden rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur lg:block">
      <p className="text-sm text-slate-300">Household net worth · example</p>
      <p className="mt-1 text-4xl font-semibold tabular">$1,284,500.00</p>
      <p className="text-xs text-slate-400">As of Oct 1, 2026 · 1 USD = 85.0000 INR (your rate)</p>
      <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded-lg bg-white/5 p-3">
          <p className="text-slate-400">US assets</p>
          <p className="font-semibold tabular">$962,300.00</p>
        </div>
        <div className="rounded-lg bg-white/5 p-3">
          <p className="text-slate-400">India assets</p>
          <p className="font-semibold tabular">₹2,73,87,000.00</p>
        </div>
      </div>
      <svg viewBox="0 0 300 90" className="mt-6 w-full">
        <path d="M0 75 L40 68 L80 70 L120 55 L160 50 L200 38 L240 30 L300 18" fill="none" stroke="#2dd4bf" strokeWidth="3" />
        <path d="M0 80 L40 78 L80 76 L120 70 L160 66 L200 60 L240 55 L300 48" fill="none" stroke="#fbbf24" strokeWidth="3" strokeDasharray="7 4" />
      </svg>
      <div className="mt-3 flex gap-2 text-[11px]">
        <span className="rounded-full border border-white/15 px-2 py-0.5">Scenario: Buy in 2028</span>
        <span className="rounded-full border border-dashed border-amber-300/60 px-2 py-0.5 text-amber-200">Illustrative</span>
      </div>
    </div>
  );
}
