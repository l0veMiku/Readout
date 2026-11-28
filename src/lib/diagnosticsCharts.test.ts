import assert from 'node:assert/strict';
import test from 'node:test';
import { boxplots, correlationHeatmap } from './diagnosticsCharts.ts';

test('heatmap keeps square-ish cells, skips the diagonal and grows with variables', () => {
  const small = correlationHeatmap(['a', 'b'], [[1, 0.4], [0.4, 1]]);
  const big = correlationHeatmap(['a', 'b', 'c', 'd', 'e'], [
    [1, 0.1, 0.2, 0.3, 0.4],
    [0.1, 1, 0.2, 0.3, 0.4],
    [0.2, 0.2, 1, 0.3, 0.4],
    [0.3, 0.3, 0.3, 1, 0.4],
    [0.4, 0.4, 0.4, 0.4, 1],
  ]);
  // 对角线不画：格子数 = n² − n
  const series = small.option.series as unknown as { data: [number, number, number][]; label: { show: boolean } }[];
  assert.equal(series[0].data.length, 2);
  assert.equal(series[0].data.some(([i, j]) => i === j), false);
  assert.equal(series[0].label.show, true);
  // 宽度随变量数线性增长（每格 34px），高度同理
  assert.equal(big.width - small.width, 3 * 34);
  assert.equal(big.height - small.height, 3 * 34);
  const bigSeries = big.option.series as unknown as { label: { show: boolean } }[];
  assert.equal(bigSeries[0].label.show, true);
  // R 常用的 RdBu：负蓝、0 白、正红；格子带白边
  const visualMap = small.option.visualMap as unknown as { inRange: { color: string[] } };
  assert.deepEqual(visualMap.inRange.color, ['#2166ac', '#f7f7f7', '#b2182b']);
  const styled = small.option.series as unknown as { itemStyle: { borderColor: string; borderWidth: number } }[];
  assert.equal(styled[0].itemStyle.borderColor, '#ffffff');
  assert.equal(styled[0].itemStyle.borderWidth, 1);
  const wide = correlationHeatmap(Array.from({ length: 9 }, (_, i) => `v${i}`), Array.from({ length: 9 }, () => Array(9).fill(0.5)));
  const wideSeries = wide.option.series as unknown as { label: { show: boolean } }[];
  assert.equal(wideSeries[0].label.show, false, '>6 个变量时不写数值');
});

test('boxplot height follows rows without a blank floor', () => {
  const one = boxplots([{ name: 'a', min: 1, q1: 2, median: 3, q3: 4, max: 5 }]);
  const four = boxplots(Array.from({ length: 4 }, (_, i) => ({ name: `v${i}`, min: 1, q1: 2, median: 3, q3: 4, max: 5 })));
  assert.equal(four.height - one.height, 3 * 36);
});
