import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Question } from '../types.ts';
import { cronbachAlpha, reliability, scaleScore } from './reliability.ts';
import { computeStat } from './stats.ts';
import { toggleReversed } from './groups.ts';
import { rel1, rel2, rel3, rel4, rel5, relAlpha, relAlphaFlippedUnmarked, relAlphaIfDeleted, relCitc } from './refdata.ts';

const close = (actual: number | null | undefined, expected: number | null, tol = 1e-9) => {
  assert.ok(actual !== null && actual !== undefined, `expected ${expected}, got nothing`);
  assert.ok(expected !== null && Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${actual} vs R ${expected}`);
};

const data = [rel1, rel2, rel3, rel4, rel5];
const items = (): Question[] => data.map((_, j) => ({ id: `q${j + 1}`, title: `q${j + 1}`, rawTitle: `q${j + 1}`, type: 'scale', included: true }));
const rowsOf = (columns: number[][]) => columns[0].map((_, ri) => Object.fromEntries(columns.map((c, j) => [`q${j + 1}`, String(c[ri])])));

test('alpha, item-total correlations and alpha if deleted match R', () => {
  const r = reliability(items(), rowsOf(data))!;
  assert.equal(r.n, 200);
  assert.equal(r.partial, 0);
  assert.equal(r.note, null);
  close(r.alpha, relAlpha);
  r.items.forEach((it, j) => {
    close(it.citc, relCitc[j]);
    close(it.alphaIfDeleted, relAlphaIfDeleted[j]);
  });
});

test('a reversed item is flipped back on the group range and its own stats stay on raw answers', () => {
  // 第 3 题在数据里已经翻转过（6 减原分）。
  const flipped = data.map((c, j) => (j === 2 ? c.map((v) => 6 - v) : c));
  const rows = rowsOf(flipped);
  const unmarked = reliability(items(), rows)!;
  close(unmarked.alpha, relAlphaFlippedUnmarked);
  assert.ok(unmarked.items[2].citc !== null && unmarked.items[2].citc < 0, 'an unmarked reversed item correlates negatively with the rest');

  const marked = reliability(items().map((q, j) => (j === 2 ? { ...q, reversed: true } : q)), rows)!;
  close(marked.alpha, relAlpha);
  marked.items.forEach((it, j) => close(it.citc, relCitc[j]));
  assert.deepEqual(marked.range, { min: 1, max: 5 });

  const raw = items()[2];
  assert.deepEqual(computeStat({ ...raw, reversed: true }, rows), computeStat(raw, rows));
});

test('only questionnaires that answered every item take part', () => {
  const rows = rowsOf(data);
  rows[3].q2 = '';
  rows[7].q4 = '未填写';
  delete rows[9].q1;
  const r = reliability(items(), rows)!;
  assert.equal(r.n, 197);
  assert.equal(r.partial, 3);
  close(r.alpha, cronbachAlpha([rel1, rel2, rel3, rel4, rel5].map((c) => c.filter((_, i) => ![3, 7, 9].includes(i))))!);
});

test('only scale items count, and fewer than two means no reliability at all', () => {
  const others: Question[] = [
    { id: 's', title: 's', rawTitle: 's', type: 'single', included: true },
    { id: 'o', title: 'o', rawTitle: 'o', type: 'open', included: true },
  ];
  const mixed = [...items(), ...others];
  const r = reliability(mixed, rowsOf(data))!;
  assert.deepEqual(
    r.items.map((it) => it.id),
    ['q1', 'q2', 'q3', 'q4', 'q5'],
  );
  assert.equal(reliability(mixed.slice(0, 1), rowsOf(data)), null);
  assert.equal(reliability([mixed[0], mixed[5], mixed[6]], rowsOf(data)), null);
});

test('identical items give alpha 1, constant answers give a reason instead of a number', () => {
  const same = [rel1, rel1, rel1];
  const r = reliability(items().slice(0, 3), rowsOf(same))!;
  close(r.alpha, 1, 1e-12);
  r.items.forEach((it) => close(it.alphaIfDeleted, 1, 1e-12));

  const flat = Array.from({ length: 20 }, () => ({ q1: '3', q2: '3', q3: '4' }));
  const constant = reliability(items().slice(0, 3), flat)!;
  assert.equal(constant.alpha, null);
  assert.match(`${constant.note}`, /取值没有变化/);
});

test('items on different ranges are refused, items missing an endpoint are fine', () => {
  const wide = Array.from({ length: 30 }, (_, i) => ({ q1: String(1 + (i % 5)), q2: String(2 + (i % 4)), q3: String((i * 7) % 11) }));
  assert.match(`${reliability(items().slice(0, 3), wide)!.note}`, /取值范围不一致/);

  const short = Array.from({ length: 30 }, (_, i) => ({ q1: String(1 + (i % 5)), q2: String(1 + (i % 4)), q3: String(1 + ((i * 3) % 5)) }));
  assert.equal(reliability(items().slice(0, 3), short)!.note, null);
});

test('text Likert labels are scored 1 to 5', () => {
  assert.equal(scaleScore('非常满意'), 5);
  assert.equal(scaleScore('不太符合'), 2);
  assert.equal(scaleScore('4'), 4);
  assert.equal(scaleScore('-'), null);
  assert.equal(scaleScore(undefined), null);
});

test('toggling a reversed mark changes only that question', () => {
  const rows = rowsOf(data);
  const ds = { fileName: 'x.csv', importedAt: '', encoding: 'UTF-8', skippedRows: 0, headers: [], rows, questions: items().slice(0, 2), groups: [] };
  const toggled = toggleReversed(ds, 'q2');
  assert.equal(toggled.questions[0], ds.questions[0]);
  assert.equal(toggled.questions[1].reversed, true);
  assert.equal(ds.questions[1].reversed, undefined);
  assert.equal(toggleReversed(toggled, 'q2').questions[1].reversed, false);
  assert.equal(toggleReversed(ds, 'missing'), ds);
});
