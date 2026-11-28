import * as echarts from 'echarts/core';
import { BoxplotChart, HeatmapChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { ChartOption } from './charts.ts';
import { escapeHtml } from './text.ts';

// 只被「数据诊断」页用到的两种图表：单独一个模块 + 动态 import，
// 这样主包不必为首屏背箱线图/热图（静态引入也做不到，模块需要在打开诊断页时才注册）。
echarts.use([BoxplotChart, HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, SVGRenderer]);

const AXIS = '#8a857b';
const GRID = '#e6dfcf';
const GREEN = '#1f5e46';

export interface BoxRow {
  name: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

// 箱线图：每行一个变量，行高固定，边距按内容给，不留地板空白。
export function boxplots(rows: BoxRow[]): { option: ChartOption; height: number } {
  const labels = rows.map((r) => r.name);
  const rowH = 36;
  return {
    height: rows.length * rowH + 56,
    option: {
      grid: { left: 4, right: 16, top: 8, bottom: 22, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const d = p as unknown as { name: string; data: number[] };
          const [min, q1, median, q3, max] = d.data;
          return `${escapeHtml(d.name)}<br/>中位数 ${median.toFixed(2)}<br/>Q1–Q3 ${q1.toFixed(2)}–${q3.toFixed(2)}<br/>范围 ${min.toFixed(2)}–${max.toFixed(2)}`;
        },
      },
      xAxis: { type: 'value', splitNumber: 4, splitLine: { lineStyle: { color: GRID } }, axisLabel: { color: AXIS, margin: 8 } },
      yAxis: {
        type: 'category',
        data: labels,
        inverse: true,
        axisLabel: { color: '#1d2621', fontSize: 12.5, width: 170, overflow: 'truncate', margin: 8 },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'boxplot',
          data: rows.map((r) => [r.min, r.q1, r.median, r.q3, r.max]),
          itemStyle: { color: GREEN, borderColor: GREEN },
          boxWidth: ['25%', '55%'],
        },
      ],
    } as ChartOption,
  };
}

export interface HeatResult {
  option: ChartOption;
  height: number;
  width: number;
  cell: number;
}

// 相关热图：照 R 的 corrplot 做法——RdBu（红–白–蓝，0 为白）、正方形格子、格子描白边、
// 对角线留空（1.00 不画），轴用编号 + 图例，避免长题干互相压字。
// 格子大小由调用方按容器宽度算好传进来（正方形不能被拉伸），宽度 = 格子×变量数 + 色标与边距。
export function correlationHeatmap(labels: string[], matrix: (number | null)[][], cell = 40): HeatResult {
  const n = labels.length;
  const size = Math.max(24, Math.round(cell));
  const right = 64; // 竖向色标与刻字
  const width = n * size + right + 8;
  const height = n * size + 30;
  const data: { value: [number, number, number]; label?: { color: string } }[] = [];
  matrix.forEach((row, i) => row.forEach((v, j) => {
    if (i === j || v === null) return;
    data.push({ value: [j, i, v], label: { color: Math.abs(v) > 0.55 ? '#ffffff' : '#1d2621' } });
  }));
  const index = { formatter: (_value: string, i: number) => String(i + 1) };
  return {
    width,
    height,
    cell: size,
    option: {
      grid: { left: 8, right, top: 8, bottom: 22, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const item = p as unknown as { data: { value: [number, number, number] } };
          const [j, i, v] = item.data.value;
          return `${i + 1}. ${escapeHtml(labels[i])} × ${j + 1}. ${escapeHtml(labels[j])}<br/>r = ${v.toFixed(2)}`;
        },
      },
      xAxis: {
        type: 'category',
        data: labels.map((_, i) => String(i + 1)),
        axisLabel: { color: AXIS, fontSize: 11, interval: 0, margin: 6, ...index },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: labels.map((_, i) => String(i + 1)),
        inverse: true,
        axisLabel: { color: AXIS, fontSize: 11, interval: 0, margin: 6 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      visualMap: {
        min: -1,
        max: 1,
        calculable: false,
        orient: 'vertical',
        right: 0,
        top: 'center',
        itemWidth: 12,
        itemHeight: 120,
        text: ['+1', '−1'],
        textStyle: { color: AXIS, fontSize: 11 },
        // RColorBrewer RdBu 的端点；0 为白，与 R corrplot / pheatmap 的相关矩阵一致。
        inRange: { color: ['#2166ac', '#f7f7f7', '#b2182b'] },
      },
      series: [
        {
          type: 'heatmap',
          data,
          itemStyle: { borderColor: '#ffffff', borderWidth: 1 },
          label: {
            show: size >= 38,
            fontSize: 11,
            formatter: (p) => {
              // ECharts 的 formatter 参数没有精确类型；data 形状由上面的 series.data 决定。
              const item = p as unknown as { data: { value: [number, number, number] } };
              return item.data.value[2].toFixed(2);
            },
          },
          emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.25)' } },
        },
      ],
    } as ChartOption,
  };
}
