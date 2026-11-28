import assert from 'node:assert/strict';
import test from 'node:test';
import { capBars, dotIntervals } from './charts.ts';

interface RenderedSeries {
  type: string;
  name?: string;
  symbol?: string;
  lineStyle?: { type?: unknown };
  emphasis?: { focus?: string };
}

const series = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `组${i + 1}`,
    points: [
      { row: 0, value: 0.5, lower: 0.4, upper: 0.6 },
      { row: 1, value: 0.3, lower: 0.2, upper: 0.4 },
    ],
  }));

const rendered = (n: number) => {
  const { option } = dotIntervals(series(n), ['A', 'B'], true);
  return {
    series: option.series as unknown as RenderedSeries[],
    legend: option.legend as unknown as { data: { name: string; icon: string }[] },
    height: dotIntervals(series(n), ['A', 'B'], true).height,
  };
};

test('groups are told apart by point shape and interval dash, not only by colour', () => {
  const { series: all, legend } = rendered(6);
  const points = all.filter((s) => s.type === 'scatter');
  const intervals = all.filter((s) => s.type === 'line');
  assert.equal(points.length, 6);
  assert.equal(new Set(points.map((s) => s.symbol)).size, 6, 'every group gets its own shape');
  assert.equal(new Set(intervals.map((s) => JSON.stringify(s.lineStyle?.type))).size, 6, 'every group gets its own dash');
  assert.deepEqual(legend.data.map((d) => d.icon), points.map((s) => s.symbol), 'legend shows the same shapes');
});

test('interval lines share the series name, so hovering one dot isolates its whole group', () => {
  const { series: all } = rendered(3);
  const points = all.filter((s) => s.type === 'scatter');
  const intervals = all.filter((s) => s.type === 'line');
  assert.deepEqual(intervals.map((s) => s.name), points.map((s) => s.name));
  assert.ok(points.every((s) => s.emphasis?.focus === 'series'));
});

test('rows grow taller as groups pile up', () => {
  const single = dotIntervals(series(1), Array(10).fill('x'), true).height;
  const crowded = dotIntervals(series(5), Array(10).fill('x'), true).height;
  assert.ok(crowded > single + 100, `${crowded} vs ${single}`);
});

const barRow = (i: number) => ({ name: `opt-${i}`, count: i + 1, pct: (i + 1) / 100, ci: null });

test('capBars keeps the head, folds the tail into one row, and leaves CI empty', () => {
  const rows = Array.from({ length: 20 }, (_, i) => barRow(i));
  const capped = capBars(rows, 12);
  assert.equal(capped.rows.length, 12);
  assert.equal(capped.omitted, 9);
  assert.equal(capped.rows[0].name, 'opt-0');
  const other = capped.rows[11];
  assert.equal(other.name, '其他 9 项');
  assert.equal(other.ci, null);
  assert.equal(other.count, rows.slice(11).reduce((s, r) => s + r.count, 0));
  assert.equal(capped.rows.reduce((s, r) => s + r.count, 0), rows.reduce((s, r) => s + r.count, 0));
});

test('capBars leaves small questions untouched', () => {
  const rows = Array.from({ length: 3 }, (_, i) => barRow(i));
  const capped = capBars(rows, 12);
  assert.equal(capped.rows, rows);
  assert.equal(capped.omitted, 0);
});
