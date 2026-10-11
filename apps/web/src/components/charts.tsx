'use client';

/**
 * Recharts wrappers. Every chart has an accessible data-table alternative (spec §17) behind a toggle, and
 * series are distinguished by dash pattern as well as colour so colour is never the only cue.
 *
 * Decimal strings are converted to numbers only to compute pixel positions; the tooltip and table use the
 * exact decimal formatting.
 */
import { analytics, formatMoney, formatMoneyCompact, toChartNumber } from '@wealthpilot/shared';
import { BarChart3, Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ChartSeries {
  key: string;
  label: string;
  /** Aligned with `xLabels`. `null` = no data point. */
  values: (string | null | undefined)[];
}

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const DASHES = [undefined, '7 4', '2 3', '10 3 2 3'];

export interface ProjectionChartProps {
  title: string;
  xLabels: string[];
  series: ChartSeries[];
  currency: string;
  kind?: 'line' | 'bar';
  height?: number;
  /** Marks x positions (e.g. deficit years) with a shaded band and a column in the table. */
  highlight?: boolean[];
  highlightLabel?: string;
  testId?: string;
  initialTable?: boolean;
  footer?: ReactNode;
  description?: ReactNode;
}

export function ProjectionChart({
  title,
  xLabels,
  series,
  currency,
  kind = 'line',
  height = 280,
  highlight,
  highlightLabel = 'Flagged',
  testId = 'projection-chart',
  initialTable = false,
  footer,
  description,
}: ProjectionChartProps) {
  const [showTable, setShowTable] = useState(initialTable);
  const data = xLabels.map((x, i) => {
    const row: Record<string, string | number | null> = { x };
    series.forEach((s) => {
      const v = s.values[i];
      row[s.key] = v == null ? null : toChartNumber(v);
    });
    return row;
  });
  const first = xLabels[0] ?? '';
  const last = xLabels[xLabels.length - 1] ?? '';
  const summary = `${title}: ${series.map((s) => s.label).join(', ')}, from ${first} to ${last}. Use “Show data table” for exact values.`;
  const toggle = () => {
    setShowTable((v) => !v);
    analytics.track('chart_table_toggled', { screen: title });
  };
  const yTick = (v: number) => formatMoneyCompact(String(Math.round(v)), currency)?.text ?? '';
  const tooltip = (
    <Tooltip
      formatter={(value, name) => {
        const s = series.find((x) => x.key === name);
        return [formatMoney(String(value), currency), s?.label ?? String(name)];
      }}
      contentStyle={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        color: 'var(--foreground)',
        fontSize: 12,
      }}
      labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
    />
  );
  const bands =
    highlight?.flatMap((h, i) => {
      const x = xLabels[i];
      return h && x !== undefined ? [x] : [];
    }) ?? [];

  return (
    <figure className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-sm font-semibold">{title}</figcaption>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          data-testid={`${testId}-toggle`}
          aria-pressed={showTable}
          title="Switch between the chart and an accessible table of the same data">
          {showTable ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />}
          {showTable ? 'Show chart' : 'Show data table'}
        </Button>
      </div>
      {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      <Legend series={series} />
      {showTable ? (
        <DataTable
          testId={`${testId}-table`}
          caption={title}
          columns={['Period', ...series.map((s) => s.label), ...(highlight ? [highlightLabel] : [])]}
          rows={xLabels.map((x, i) => [
            x,
            ...series.map((s) => formatMoney(s.values[i], currency)),
            ...(highlight ? [highlight[i] ? `Yes (${highlightLabel})` : 'No'] : []),
          ])}
        />
      ) : (
        <div role="img" aria-label={summary} style={{ height }} className="w-full min-w-0">
          {xLabels.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height }}>
              {kind === 'line' ? (
                <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} accessibilityLayer={false}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="x" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} stroke="var(--border)" minTickGap={16} />
                  <YAxis tickFormatter={yTick} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={72} />
                  {bands.map((x) => (
                    <ReferenceArea key={`hl-${x}`} x1={x} x2={x} fill="var(--chart-deficit)" fillOpacity={0.8} ifOverflow="extendDomain" />
                  ))}
                  {tooltip}
                  {series.map((s, i) => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.key}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2.5}
                      strokeDasharray={DASHES[i % DASHES.length]}
                      dot={xLabels.length <= 24 ? { r: 3, strokeWidth: 0, fill: COLORS[i % COLORS.length] } : false}
                      activeDot={{ r: 5 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              ) : (
                <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} accessibilityLayer={false}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="x" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} stroke="var(--border)" minTickGap={8} />
                  <YAxis tickFormatter={yTick} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={72} />
                  {tooltip}
                  {series.map((s, i) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={s.key}
                      fill={COLORS[i % COLORS.length]}
                      fillOpacity={i % 2 === 1 ? 0.75 : 1}
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No data to chart yet.</p>
          )}
        </div>
      )}
      {footer}
    </figure>
  );
}

export function Legend({ series }: { series: { key: string; label: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5 text-xs">
          <svg width="28" height="10" aria-hidden className="shrink-0">
            <line
              x1="0"
              x2="28"
              y1="5"
              y2="5"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth="3"
              strokeDasharray={DASHES[i % DASHES.length]}
            />
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export function DataTable({
  columns,
  rows,
  caption,
  testId = 'data-table',
  className,
}: {
  columns: string[];
  rows: ReactNode[][];
  caption?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={cn('max-w-full overflow-x-auto rounded-lg border', className)} data-testid={testId} tabIndex={0} role="region" aria-label={caption ? `${caption} table` : 'Data table'}>
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="bg-muted">
          <tr>
            {columns.map((c, i) => (
              <th key={c} scope="col" className={cn('px-3 py-2 font-medium whitespace-nowrap', i === 0 ? 'text-left' : 'text-right')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t">
              {r.map((cell, ci) =>
                ci === 0 ? (
                  <th key={ci} scope="row" className="px-3 py-1.5 text-left font-normal whitespace-nowrap">
                    {cell}
                  </th>
                ) : (
                  <td key={ci} className="px-3 py-1.5 text-right whitespace-nowrap tabular">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
