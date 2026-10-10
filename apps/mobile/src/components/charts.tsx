/**
 * Lightweight charts on react-native-svg (bundles identically on iOS, Android and web).
 * Every chart has an accessible data-table alternative (spec §17). Series are distinguished by dash
 * pattern and marker shape as well as color, so color is never the only cue.
 *
 * Decimal strings are converted to numbers only to compute pixel positions; labels and tables use the
 * exact decimal formatting.
 */
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { analytics } from '../lib/analytics';
import { toChartNumber } from '../lib/decimal';
import { formatMoney, formatMoneyCompact } from '../lib/money';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Row, Text } from './primitives';

export interface ChartSeries {
  key: string;
  label: string;
  /** Aligned with `xLabels`. `null` = no data point. */
  values: (string | null | undefined)[];
}

const DASHES = [undefined, '6 4', '2 3', '10 3 2 3', '1 0'];
const MARKERS = ['circle', 'square', 'triangle', 'diamond', 'circle'] as const;

export interface ProjectionChartProps {
  title: string;
  xLabels: string[];
  series: ChartSeries[];
  currency: string;
  kind?: 'line' | 'bar';
  height?: number;
  /** Marks x positions (e.g. deficit years) with a hatched band + label in the table. */
  highlight?: boolean[];
  highlightLabel?: string;
  testID?: string;
  /** Start in table mode (useful for tests and screen-reader users). */
  initialTable?: boolean;
  footer?: ReactNode;
}

export function ProjectionChart({
  title,
  xLabels,
  series,
  currency,
  kind = 'line',
  height = 220,
  highlight,
  highlightLabel = 'Flagged',
  testID = 'projection-chart',
  initialTable = false,
  footer,
}: ProjectionChartProps) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [showTable, setShowTable] = useState(initialTable);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const nums = series.map((s) => s.values.map((v) => (v == null ? null : toChartNumber(v))));
  const flat = nums.flat().filter((v): v is number => v !== null);
  const rawMin = flat.length ? Math.min(0, ...flat) : 0;
  const rawMax = flat.length ? Math.max(...flat, 0) : 1;
  const [yMin, yMax] = niceRange(rawMin, rawMax === rawMin ? rawMin + 1 : rawMax);

  const padL = 64;
  const padR = 12;
  const padT = 10;
  const padB = 28;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = height - padT - padB;
  const n = xLabels.length;
  const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const yAt = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const ticks = [0, 1, 2, 3, 4].map((i) => yMin + ((yMax - yMin) * i) / 4);
  const labelEvery = Math.max(1, Math.ceil(n / 5));

  const first = xLabels[0] ?? '';
  const last = xLabels[n - 1] ?? '';
  const summary = `${title} chart, ${series.map((s) => s.label).join(', ')}, from ${first} to ${last}. Use Show data table for exact values.`;

  const toggle = () => {
    setShowTable((v) => !v);
    analytics.track('chart_table_toggled', { screen: title });
  };

  return (
    <View testID={testID} style={styles.wrap}>
      <Row>
        <Text variant="bodyStrong" style={styles.flex}>
          {title}
        </Text>
        <Button
          compact
          variant="ghost"
          label={showTable ? 'Show chart' : 'Show data table'}
          icon={showTable ? 'stats-chart-outline' : 'list-outline'}
          onPress={toggle}
          testID={`${testID}-toggle`}
          accessibilityHint="Switches between the chart and an accessible table of the same data"
        />
      </Row>
      <Legend series={series} />
      {showTable ? (
        <DataTable
          testID={`${testID}-table`}
          caption={title}
          columns={['Period', ...series.map((s) => s.label), ...(highlight ? [highlightLabel] : [])]}
          rows={xLabels.map((x, i) => [
            x,
            ...series.map((s) => formatMoney(s.values[i], currency)),
            ...(highlight ? [highlight[i] ? `Yes (${highlightLabel})` : 'No'] : []),
          ])}
        />
      ) : (
        <View onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={summary}>
          {width > 0 && n > 0 ? (
            <Svg width={width} height={height}>
              {ticks.map((tv, i) => (
                <G key={`tick-${i}`}>
                  <Line x1={padL} x2={width - padR} y1={yAt(tv)} y2={yAt(tv)} stroke={t.colors.border} strokeWidth={1} />
                  <SvgText x={padL - 6} y={yAt(tv) + 4} fontSize={12} fill={t.colors.textMuted} textAnchor="end">
                    {formatMoneyCompact(String(Math.round(tv)), currency)?.text ?? ''}
                  </SvgText>
                </G>
              ))}
              {highlight?.map((h, i) =>
                h ? (
                  <Rect
                    key={`hl-${i}`}
                    x={xAt(i) - Math.max(2, plotW / Math.max(1, n) / 2)}
                    y={padT}
                    width={Math.max(4, plotW / Math.max(1, n))}
                    height={plotH}
                    fill={t.colors.dangerBg}
                    opacity={0.7}
                  />
                ) : null,
              )}
              {kind === 'line'
                ? nums.map((vals, si) => (
                    <G key={series[si]!.key}>
                      <Path
                        d={linePath(vals, xAt, yAt)}
                        stroke={t.colors.chart[si % t.colors.chart.length]}
                        strokeWidth={2.5}
                        strokeDasharray={DASHES[si % DASHES.length]}
                        fill="none"
                      />
                      {vals.map((v, i) =>
                        v === null || (n > 12 && i % labelEvery !== 0 && i !== n - 1) ? null : (
                          <Marker
                            key={i}
                            shape={MARKERS[si % MARKERS.length]!}
                            x={xAt(i)}
                            y={yAt(v)}
                            color={t.colors.chart[si % t.colors.chart.length]!}
                          />
                        ),
                      )}
                    </G>
                  ))
                : nums.map((vals, si) => {
                    const groupW = n > 0 ? plotW / n : plotW;
                    const barW = Math.max(2, (groupW * 0.8) / series.length);
                    return (
                      <G key={series[si]!.key}>
                        {vals.map((v, i) => {
                          if (v === null) return null;
                          const x = padL + i * groupW + groupW * 0.1 + si * barW;
                          const y0 = yAt(0);
                          const y1 = yAt(v);
                          return (
                            <Rect
                              key={i}
                              x={x}
                              y={Math.min(y0, y1)}
                              width={barW}
                              height={Math.max(1, Math.abs(y1 - y0))}
                              fill={t.colors.chart[si % t.colors.chart.length]}
                              opacity={si % 2 === 1 ? 0.75 : 1}
                            />
                          );
                        })}
                      </G>
                    );
                  })}
              {xLabels.map((x, i) =>
                i % labelEvery === 0 || i === n - 1 ? (
                  <SvgText
                    key={`x-${i}`}
                    x={kind === 'bar' ? padL + (i + 0.5) * (plotW / Math.max(1, n)) : xAt(i)}
                    y={height - 8}
                    fontSize={12}
                    fill={t.colors.textMuted}
                    textAnchor="middle">
                    {x}
                  </SvgText>
                ) : null,
              )}
            </Svg>
          ) : (
            <View style={{ height }} />
          )}
        </View>
      )}
      {footer}
    </View>
  );
}

function Marker({ shape, x, y, color }: { shape: (typeof MARKERS)[number]; x: number; y: number; color: string }) {
  const r = 3.5;
  if (shape === 'square') return <Rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={color} />;
  if (shape === 'triangle') return <Path d={`M${x} ${y - r - 1} L${x + r + 1} ${y + r} L${x - r - 1} ${y + r} Z`} fill={color} />;
  if (shape === 'diamond') return <Path d={`M${x} ${y - r - 1} L${x + r + 1} ${y} L${x} ${y + r + 1} L${x - r - 1} ${y} Z`} fill={color} />;
  return <Circle cx={x} cy={y} r={r} fill={color} />;
}

function linePath(vals: (number | null)[], xAt: (i: number) => number, yAt: (v: number) => number): string {
  let d = '';
  let pen = false;
  vals.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)} `;
    pen = true;
  });
  return d.trim();
}

/** Round the y-range outward to "nice" numbers so gridlines land on readable values. */
export function niceRange(min: number, max: number): [number, number] {
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span || 1)));
  const err = span / step;
  const mult = err <= 2 ? 0.5 : err <= 5 ? 1 : 2;
  const s = step * mult;
  return [Math.floor(min / s) * s, Math.ceil(max / s) * s];
}

export function Legend({ series }: { series: { key: string; label: string }[] }) {
  const t = useTheme();
  return (
    <Row wrap gap={12} style={styles.legend}>
      {series.map((s, i) => (
        <Row key={s.key} gap={6}>
          <Svg width={28} height={12} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Line
              x1={0}
              x2={28}
              y1={6}
              y2={6}
              stroke={t.colors.chart[i % t.colors.chart.length]}
              strokeWidth={3}
              strokeDasharray={DASHES[i % DASHES.length]}
            />
            <Marker shape={MARKERS[i % MARKERS.length]!} x={14} y={6} color={t.colors.chart[i % t.colors.chart.length]!} />
          </Svg>
          <Text variant="caption">{s.label}</Text>
        </Row>
      ))}
    </Row>
  );
}

// ---------------------------------------------------------------------------
// DataTable
// ---------------------------------------------------------------------------

export function DataTable({
  columns,
  rows,
  caption,
  testID = 'data-table',
}: {
  columns: string[];
  rows: string[][];
  caption?: string;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <ScrollView horizontal testID={testID} accessibilityLabel={caption ? `${caption} table` : 'Data table'}>
      <View style={[styles.table, { borderColor: t.colors.border }]}>
        <View style={[styles.tr, { backgroundColor: t.colors.surfaceAlt }]} accessibilityRole="header">
          {columns.map((c) => (
            <View key={c} style={styles.td}>
              <Text variant="label">{c}</Text>
            </View>
          ))}
        </View>
        {rows.map((r, ri) => (
          <View
            key={ri}
            style={[styles.tr, { borderTopColor: t.colors.border }, styles.trBorder]}
            accessible
            accessibilityLabel={r.map((cell, ci) => `${columns[ci]}: ${cell}`).join(', ')}>
            {r.map((cell, ci) => (
              <View key={ci} style={styles.td}>
                <Text variant="caption" tabular>
                  {cell}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  flex: { flex: 1 },
  legend: { marginBottom: 4 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, overflow: 'hidden' },
  tr: { flexDirection: 'row' },
  trBorder: { borderTopWidth: StyleSheet.hairlineWidth },
  td: { minWidth: 110, paddingHorizontal: 8, paddingVertical: 6 },
});
