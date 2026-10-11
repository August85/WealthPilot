/**
 * Date-only helpers. Contract dates are `YYYY-MM-DD` with no timezone; never pass them through
 * `new Date(str)` (which parses as UTC midnight and can shift the day in US timezones).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function parseIsoDate(s: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** "2026-10-10" → "Oct 10, 2026" */
export function formatDate(s: string | null | undefined): string {
  const p = parseIsoDate(s);
  if (!p) return '—';
  return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

/** "2026-10-10" → "Oct 2026" */
export function formatMonthYear(s: string | null | undefined): string {
  const p = parseIsoDate(s);
  if (!p) return '—';
  return `${MONTHS[p.m - 1]} ${p.y}`;
}

/** Spoken form for screen readers: "October 10, 2026". */
export function spokenDate(s: string | null | undefined): string {
  const p = parseIsoDate(s);
  if (!p) return 'unknown date';
  return `${MONTHS_LONG[p.m - 1]} ${p.d}, ${p.y}`;
}

/** Today's local calendar date as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toUtcMs(s: string): number | null {
  const p = parseIsoDate(s);
  if (!p) return null;
  return Date.UTC(p.y, p.m - 1, p.d);
}

/** Whole days from `from` to `to` (both date-only). */
export function daysBetween(from: string, to: string): number | null {
  const a = toUtcMs(from);
  const b = toUtcMs(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

export function addDays(s: string, days: number): string {
  const ms = toUtcMs(s);
  if (ms === null) return s;
  const dt = new Date(ms + days * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function addMonths(s: string, months: number): string {
  const p = parseIsoDate(s);
  if (!p) return s;
  const total = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(p.d, lastDay);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "in 14 days" / "today" / "3 days ago" */
export function relativeDays(s: string, today: string = todayIso()): string {
  const n = daysBetween(today, s);
  if (n === null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** ISO timestamp → "Oct 10, 2026, 20:00 UTC" (kept in UTC to avoid ambiguity). */
export function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return '—';
  const date = ts.slice(0, 10);
  const time = ts.slice(11, 16);
  return time ? `${formatDate(date)}, ${time} UTC` : formatDate(date);
}
