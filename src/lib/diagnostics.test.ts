import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDiagnostics, fiveNumbers, kmoBand } from './diagnostics.ts';
import type { CardItem } from './groups.ts';
import type { Question } from '../types.ts';

const q = (id: string, title: string, type: Question['type'], extra: Partial<Question> = {}): Question => ({ id, title, rawTitle: title, type, included: true, ...extra });
const stat = (n: number, missing = 0) => ({ n, missing, kind: 'scale', levels: [], numeric: true, mean: 3, median: 3, sd: 1, top2: null, meanCI: null, top2CI: null, shape: { n, skew: 2.1, skewSE: Math.sqrt(6 / n), kurtosis: 0.5, kurtosisSE: Math.sqrt(24 / n) } }) as never;

const items: CardItem[] = [
  { kind: 'question', question: q('a', '时长', 'numeric') },
  { kind: 'group', group: { id: 'g1', title: '满意度', questionIds: ['b', 'c'] }, questions: [q('b', '题1', 'scale'), q('c', '题2', 'scale', { reversed: false })] },
];

test('five numbers use type-7 quartiles', () => {
  const five = fiveNumbers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(five);
  assert.equal(five.min, 1);
  assert.equal(five.max, 10);
  assert.equal(five.median, 5.5);
  assert.equal(five.q1, 3.25);
  assert.equal(fiveNumbers([1, 2, 3, 4]), null);
});

test('KMO bands are text, not pass/fail', () => {
  assert.equal(kmoBand(0.82), '好');
  assert.equal(kmoBand(0.72), '中');
  assert.equal(kmoBand(0.62), '勉强');
  assert.equal(kmoBand(0.41), '不适合');
});

test('issues cover missing, skew, low alpha, KMO and unmarked reverse items', () => {
  const stats = {
    a: stat(20, 8),
    b: stat(30),
    c: stat(30),
  } as never;
  const reliabilities = {
    g1: { items: [{ id: 'b', citc: 0.5, alphaIfDeleted: null, alphaIfReversed: 0.5 }, { id: 'c', citc: -0.4, alphaIfDeleted: null, alphaIfReversed: 0.8 }], n: 30, partial: 0, alpha: 0.62, range: { min: 1, max: 5 }, note: null },
  } as never;
  const extras = {
    g1: { n: 30, alphaCI: { lower: 0.4, upper: 0.8 }, kmo: 0.55, bartlett: { chi2: 100, df: 1, p: 0.001 }, omega: 0.6, notes: [] },
  } as never;
  const diagnostics = buildDiagnostics({ dataset: {} as never, items, stats, reliabilities, extras });
  const titles = diagnostics.issues.map((i) => `${i.level}:${i.title}`);
  assert.ok(titles.some((t) => t.startsWith('alert') && t.includes('反向题')), titles.join('\n'));
  assert.ok(titles.some((t) => t.startsWith('alert') && t.includes('缺失')), titles.join('\n'));
  assert.ok(titles.some((t) => t.startsWith('warn') && t.includes('偏度')), titles.join('\n'));
  assert.ok(titles.some((t) => t.startsWith('warn') && t.includes('α')), titles.join('\n'));
  assert.ok(titles.some((t) => t.startsWith('warn') && t.includes('KMO')), titles.join('\n'));
  // 严重度排序：alert 在前
  const levels = diagnostics.issues.map((i) => i.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => ({ alert: 0, warn: 1, info: 2 }[a] - { alert: 0, warn: 1, info: 2 }[b])));
  // 卡片索引对应工作台顺序
  assert.equal(diagnostics.missing.find((m) => m.id === 'a')?.cardIndex, 0);
  assert.equal(diagnostics.groups[0].cardIndex, 1);
});
