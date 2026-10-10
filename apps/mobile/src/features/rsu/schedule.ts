import { addMonths } from '@/lib/dates';
import { D, dec } from '@/lib/decimal';

export interface ScheduleInput {
  start_date: string;
  cliff_months: number;
  frequency_months: number;
  total_months: number;
}

/**
 * Client-side PREVIEW of the server's schedule generator (contract: equal vest events, remainder on the
 * last vest, cliff vest gets the accrued amount). The API generates the real vests.
 */
export function previewSchedule(granted: string, s: ScheduleInput): { vest_date: string; shares: string }[] {
  const total = dec(granted);
  if (total.lte(0) || s.total_months <= 0 || s.frequency_months <= 0) return [];
  const periods = Math.floor(s.total_months / s.frequency_months);
  if (periods <= 0) return [];
  const perPeriod = total.dividedBy(periods).toDecimalPlaces(0, D.ROUND_DOWN);
  const events: { month: number; periodsCovered: number }[] = [];
  const firstMonth = Math.max(s.cliff_months, s.frequency_months);
  const cliffPeriods = Math.max(1, Math.floor(firstMonth / s.frequency_months));
  events.push({ month: firstMonth, periodsCovered: cliffPeriods });
  for (let m = firstMonth + s.frequency_months; m <= s.total_months; m += s.frequency_months) {
    events.push({ month: m, periodsCovered: 1 });
  }
  let allocated = new D(0);
  return events.map((e, i) => {
    const isLast = i === events.length - 1;
    const shares = isLast ? total.minus(allocated) : perPeriod.times(e.periodsCovered);
    allocated = allocated.plus(shares);
    return { vest_date: addMonths(s.start_date, e.month), shares: shares.toFixed() };
  });
}
