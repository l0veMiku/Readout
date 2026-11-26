import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { BarSeriesOption } from 'echarts/charts';
import type { GridComponentOption, MarkLineComponentOption, TooltipComponentOption } from 'echarts/components';

echarts.use([BarChart, GridComponent, TooltipComponent, MarkLineComponent, SVGRenderer]);

export type ChartOption = echarts.ComposeOption<BarSeriesOption | GridComponentOption | TooltipComponentOption | MarkLineComponentOption>;

const GREEN = '#1f5e46';
const SOFT = '#a9c2b4';
const AXIS = '#8a857b';
const GRID = '#e6dfcf';

export interface BarRow {
  name: string;
  count: number;
  pct: number;
}

const tooltip = (total: number): TooltipComponentOption => ({
  trigger: 'axis',
  axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(31, 94, 70, 0.08)' } },
  formatter: (params) => {
    const p = Array.isArray(params) ? params[0] : params;
    const row = p.data as { value: number; pct?: number };
    const pct = row.pct !== undefined ? `${(row.pct * 100).toFixed(1)}%` : `${((row.value / total) * 100).toFixed(1)}%`;
    return `${p.name}<br/>人数 <b>${row.value}</b> · 占比 <b>${pct}</b>`;
  },
});

export function horizontalBars(rows: BarRow[]): { option: ChartOption; height: number } {
  const data = [...rows].reverse();
  return {
    height: rows.length * 30 + 46,
    option: {
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      tooltip: tooltip(rows.reduce((s, r) => s + r.count, 0)),
      xAxis: { type: 'value', show: false, max: (v) => v.max * 1.12 },
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
          label: { show: true, position: 'right', color: '#4a544e', fontSize: 12, formatter: (p) => `${((p.data as BarRow).pct * 100).toFixed(1)}%` },
        },
      ],
    },
  };
}

export function verticalBars(rows: BarRow[], opts: { mean?: number | null; rotate?: boolean } = {}): { option: ChartOption; height: number } {
  const mean = opts.mean ?? null;
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
          })),
          barMaxWidth: 46,
          label: { show: true, position: 'top', color: '#4a544e', fontSize: 12, formatter: (p) => `${((p.data as BarRow).pct * 100).toFixed(0)}%` },
          markLine: mean == null
            ? undefined
            : {
                silent: true,
                symbol: 'none',
                lineStyle: { color: '#a4442a', type: 'dashed', width: 1.5 },
                label: { color: '#a4442a', fontSize: 12, rotate: 0, position: 'end', formatter: `均值 ${mean.toFixed(2)}` },
                data: [{ xAxis: mean - 1 }],
              },
        },
      ],
    },
  };
}
