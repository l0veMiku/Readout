import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { BarSeriesOption, LineSeriesOption, ScatterSeriesOption } from 'echarts/charts';
import type { GridComponentOption, LegendComponentOption, MarkLineComponentOption, TooltipComponentOption } from 'echarts/components';
import { escapeHtml, formatRange } from './text.ts';

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, MarkLineComponent, SVGRenderer]);

export type ChartOption = echarts.ComposeOption<
  BarSeriesOption | LineSeriesOption | ScatterSeriesOption | GridComponentOption | LegendComponentOption | TooltipComponentOption | MarkLineComponentOption
>;

export const GROUP_COLORS = ['#1f5e46', '#a4442a', '#3d6fb0', '#8a6d1f', '#7a5ba6', '#2a7f8f', '#8c5a3c', '#5b6270'];

const GREEN = '#1f5e46';
const SOFT = '#a9c2b4';
const AXIS = '#8a857b';
const GRID = '#e6dfcf';

export interface BarRow {
  name: string;
  count: number;
  pct: number;
  ci?: { lower: number; upper: number } | null;
}

const WHISKER = '#3a453f';
const NO_TIP = { silent: true, tooltip: { show: false }, emphasis: { disabled: true } } as const;

// 误差条是两段堆叠的细条：下限以下透明、区间段可见，占比标签贴在区间上限外侧。
// 区间是占比的区间，换算成与柱子相同的「人数」刻度（n × 占比）。
function whisker(data: BarRow[], horizontal: boolean): BarSeriesOption[] {
  const scale = (r: BarRow) => (r.ci && r.pct > 0 ? r.count / r.pct : 0);
  const lower = (r: BarRow) => scale(r) * (r.ci?.lower ?? 0);
  const upper = (r: BarRow) => scale(r) * ((r.ci?.upper ?? 0) - (r.ci?.lower ?? 0));
  return [
    {
      type: 'bar',
      stack: 'ci',
      ...NO_TIP,
      barWidth: 2,
      barGap: '-100%',
      data: data.map((r) => ({ value: lower(r), itemStyle: { color: 'transparent' } })),
    },
    {
      type: 'bar',
      stack: 'ci',
      ...NO_TIP,
      barWidth: 2,
      itemStyle: { color: WHISKER },
      label: {
        show: true,
        position: horizontal ? 'right' : 'top',
        color: '#4a544e',
        fontSize: 12,
        formatter: (p: { dataIndex: number }) => `${(data[p.dataIndex].pct * 100).toFixed(horizontal ? 1 : 0)}%`,
      },
      data: data.map((r) => ({ value: upper(r), label: { show: !!r.ci } })),
    },
  ];
}

const tooltip = (total: number): TooltipComponentOption => ({
  trigger: 'axis',
  axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(31, 94, 70, 0.08)' } },
  formatter: (params) => {
    const list = Array.isArray(params) ? params : [params];
    const p = list.find((x) => (x.data as { pct?: number }).pct !== undefined) ?? list[0];
    const row = p.data as { value: number; pct?: number };
    const pct = row.pct !== undefined ? `${(row.pct * 100).toFixed(1)}%` : `${((row.value / total) * 100).toFixed(1)}%`;
    return `${escapeHtml(p.name)}<br/>人数 <b>${row.value}</b> · 占比 <b>${pct}</b>`;
  },
});

export function horizontalBars(rows: BarRow[]): { option: ChartOption; height: number } {
  const data = [...rows].reverse();
  const top = Math.max(0, ...rows.map((r) => (r.ci && r.pct > 0 ? (r.count / r.pct) * r.ci.upper : r.count)));
  return {
    height: rows.length * 30 + 46,
    option: {
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      tooltip: tooltip(rows.reduce((s, r) => s + r.count, 0)),
      xAxis: { type: 'value', show: false, max: top * 1.12 },
      // 数据倒序后第一项落在最上方，即人数最多的选项在最上面。
      yAxis: {
        type: 'category',
        data: data.map((r) => r.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#1d2621', fontSize: 13, width: 180, overflow: 'truncate' },
      },
      series: [
        {
          type: 'bar',
          data: data.map((r, i) => ({
            value: r.count,
            pct: r.pct,
            itemStyle: { color: i === data.length - 1 ? GREEN : SOFT, borderRadius: [0, 3, 3, 0] },
          })),
          barMaxWidth: 22,
        },
        ...whisker(data, true),
      ],
    },
  };
}

// 量表档位不一定从 1 开始（如 0–10 分），均值线要按档位数值换算成类目坐标。
function meanLineIndex(rows: BarRow[], mean: number) {
  const xs = rows.map((r) => Number(r.name));
  if (xs.length < 2 || xs.some((x) => !Number.isFinite(x))) return mean - 1;
  const step = xs[1] - xs[0];
  if (step <= 0) return mean - 1;
  const even = xs.every((x, i) => Math.abs(x - (xs[0] + i * step)) < 1e-9);
  return even ? (mean - xs[0]) / step : mean - 1;
}

export function verticalBars(rows: BarRow[], opts: { mean?: number | null; rotate?: boolean } = {}): { option: ChartOption; height: number } {
  const mean = opts.mean ?? null;
  const meanIndex = mean === null ? null : meanLineIndex(rows, mean);
  // 量表图突出最高档，直方图突出最高的分箱。
  const highlight = mean != null ? rows.length - 1 : rows.reduce((best, r, i) => (r.count > rows[best].count ? i : best), 0);
  return {
    height: 250,
    option: {
      grid: { left: 8, right: 8, top: 36, bottom: opts.rotate ? 44 : 24, containLabel: true },
      tooltip: tooltip(rows.reduce((s, r) => s + r.count, 0)),
      xAxis: {
        type: 'category',
        data: rows.map((r) => r.name),
        axisLine: { lineStyle: { color: AXIS } },
        axisTick: { show: false },
        axisLabel: { color: '#1d2621', fontSize: 12, rotate: opts.rotate ? 30 : 0, interval: 0 },
      },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: GRID } }, axisLabel: { color: AXIS } },
      series: [
        {
          type: 'bar',
          data: rows.map((r, i) => ({
            value: r.count,
            pct: r.pct,
            itemStyle: { color: i === highlight ? GREEN : SOFT, borderRadius: [3, 3, 0, 0] },
            label: { show: !r.ci },
          })),
          barMaxWidth: 46,
          label: { show: true, position: 'top', color: '#4a544e', fontSize: 12, formatter: (p) => `${((p.data as BarRow).pct * 100).toFixed(0)}%` },
          markLine: meanIndex === null
            ? undefined
            : {
                silent: true,
                symbol: 'none',
                lineStyle: { color: '#a4442a', type: 'dashed', width: 1.5 },
                label: { color: '#a4442a', fontSize: 12, rotate: 0, position: 'end', distance: 13, formatter: `均值 ${mean!.toFixed(2)}` },
                data: [{ xAxis: meanIndex }],
              },
        },
        ...whisker(rows, false),
      ],
    },
  };
}

export function meanIntervals(rows: { name: string; value: number; ci: { lower: number; upper: number } | null }[]): { option: ChartOption; height: number } {
  const points = rows.map((r, i) => ({ row: i, value: r.value, lower: r.ci?.lower ?? null, upper: r.ci?.upper ?? null }));
  return dotIntervals([{ name: '均值', points }], rows.map((r) => r.name), false);
}

export interface DotPoint {
  row: number;
  value: number;
  lower: number | null;
  upper: number | null;
}

export interface DotSeries {
  name: string;
  points: DotPoint[];
}

// 把带 6% 余量的上限收成整齐刻度，避免坐标轴末端出现 4.876937424804657 这类标签。
function niceCeil(x: number) {
  const step = x <= 10 ? 1 : x <= 50 ? 5 : x <= 200 ? 10 : 50;
  return Math.ceil(x / step) * step;
}

// 分组不只靠颜色区分：每组一套点形状 + 区间线型，灰度打印或色觉受限时也能对上图例。
const SYMBOLS = ['circle', 'rect', 'triangle', 'diamond', 'roundRect', 'pin', 'arrow', 'circle'] as const;
const DASHES: (number[] | undefined)[] = [undefined, [6, 4], [2, 3], [10, 3, 2, 3], [1, 3], [8, 5], [4, 2, 1, 2], [12, 4]];

// 「点 + 区间」图：每个选项一行，每组一个点，点两侧的横线是 95% 区间。
export function dotIntervals(series: DotSeries[], rowLabels: string[], pct: boolean): { option: ChartOption; height: number } {
  const step = series.length > 1 ? Math.min(0.3, 0.9 / series.length) : 0;
  const offset = (g: number) => ((series.length - 1) / 2 - g) * step;
  const fmt = (v: number) => (pct ? `${(v * 100).toFixed(1)}%` : v.toFixed(2));
  const tops = series.flatMap((s) => s.points.map((p) => p.upper ?? p.value));
  // 组多时每行留高一点，点与区间才不会叠在一起。
  const rowH = series.length >= 5 ? 60 : series.length >= 3 ? 52 : 46;
  return {
    height: rowLabels.length * rowH + (series.length > 1 ? 44 : 16),
    option: {
      grid: { left: 8, right: 96, top: series.length > 1 ? 36 : 12, bottom: 12, containLabel: true },
      legend: {
        show: series.length > 1,
        top: 0,
        left: 8,
        itemWidth: 12,
        itemHeight: 12,
        itemGap: 14,
        data: series.map((s, g) => ({ name: s.name, icon: SYMBOLS[g % SYMBOLS.length] })),
        textStyle: { color: '#1d2621', fontSize: 12.5 },
      },
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const d = p as unknown as { data: { point: DotPoint; group: string; name: string } };
          const ci =
            d.data.point.lower === null || d.data.point.upper === null
              ? '区间无法计算'
              : `95% 区间 ${formatRange(d.data.point.lower, d.data.point.upper, fmt)}`;
          return `${escapeHtml(d.data.group)} · ${escapeHtml(d.data.name)}<br/>${fmt(d.data.point.value)}<br/>${ci}`;
        },
      },
      xAxis: {
        type: 'value',
        min: pct ? 0 : (v: { min: number }) => Math.min(v.min, 0),
        max: pct ? 1 : (v: { max: number }) => niceCeil(Math.max(...tops, v.max) * 1.06),
        splitLine: { lineStyle: { color: GRID } },
        axisLabel: { color: AXIS, formatter: (v: number) => (pct ? `${Math.round(v * 100)}%` : String(Math.round(v * 100) / 100)) },
      },
      yAxis: {
        type: 'value',
        min: -0.5,
        max: rowLabels.length - 0.5,
        inverse: true,
        axisLabel: { color: '#1d2621', fontSize: 13, margin: 12, formatter: (v: number) => (Number.isInteger(v) ? (rowLabels[v] ?? '') : '') },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      series: series.flatMap((s, g) => {
        const color = GROUP_COLORS[g % GROUP_COLORS.length];
        const symbol = SYMBOLS[g % SYMBOLS.length];
        const dash = DASHES[g % DASHES.length];
        const at = (p: DotPoint) => [p.value, p.row + offset(g)] as [number, number];
        return [
          {
            type: 'line',
            name: s.name,
            data: s.points.flatMap((p) => (p.lower === null || p.upper === null ? [] : [[p.lower, p.row + offset(g)], [p.upper, p.row + offset(g)], ['-', '-']])),
            lineStyle: { color, width: 2, type: dash ?? 'solid', cap: 'round' },
            symbol: 'none',
            z: 2,
            ...NO_TIP,
          },
          {
            type: 'scatter',
            name: s.name,
            itemStyle: { color, borderColor: '#fcfaf5', borderWidth: 1.5 },
            symbol,
            symbolSize: symbol === 'rect' || symbol === 'roundRect' ? 9 : 10,
            emphasis: { focus: 'series', scale: 1.5 },
            z: 3,
            data: s.points.map((p) => ({ value: at(p), point: p, group: s.name, name: rowLabels[p.row] })),
          },
        ];
      }),
    },
  };
}
