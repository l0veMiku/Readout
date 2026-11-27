import assert from 'node:assert/strict';
import test from 'node:test';
import { correlationFor, pearsonPair } from './correlation.ts';
import type { Question } from '../types.ts';

// 基准数据来自仓库外的 R 脚本：a/b/c 三列有缺失，cor.test 的默认方法（Pearson、成对删除）输出下面的数。
const A = [5, 5, null, 4, 4, 3, null, 2, 4, 4, 3, 4];
const B = [5, 2, 3, 5, null, 1, 3, 3, 5, 2, 5, 5];
const C = [1, 3, 3, 5, 3, 4, 4, 4, null, null, null, 4];

const close = (actual: number | null, expected: number) => {
  assert.ok(actual !== null, `got ${actual}, want ${expected}`);
  assert.ok(Math.abs(actual - expected) < 1e-9, `got ${actual}, want ${expected}`);
};

test('r, the Fisher z interval, and the p value match R cor.test', () => {
  const ab = pearsonPair(A, B);
  assert.equal(ab.n, 9);
  close(ab.r, 0.18098069149825674);
  close(ab.ci!.lower, -0.54914444817911878);
  close(ab.ci!.upper, 0.75442557136043287);
  close(ab.p, 0.64122483490802651);

  const ac = pearsonPair(A, C);
  assert.equal(ac.n, 7);
  close(ac.r, -0.56011203361120387);
  close(ac.ci!.lower, -0.92359895749206);
  close(ac.ci!.upper, 0.33369948860503668);
  close(ac.p, 0.19097230337748999);

  const bc = pearsonPair(B, C);
  assert.equal(bc.n, 8);
  close(bc.r, -0.11905136851988175);
  close(bc.ci!.lower, -0.75996878548106517);
  close(bc.ci!.upper, 0.63924966997524835);
  close(bc.p, 0.77887889365643292);
});

test('a strong correlation matches R, and the interval excludes 0', () => {
  const X = [5, 3, 1, 1, 2, 4, 2, 5, 2, 3, 2, 2, 4, 1, 3, 1, 3, 1, 5, 2, 4, 2, 5, 5, 5, 1, 4, 3, 5, 2];
  const Y = [5, 2, 1, 1, 3, 5, 3, 5, 1, 4, 2, 3, 4, 1, 3, 1, 4, 1, 5, 2, 4, 3, 4, 5, 5, 2, 3, 3, 4, 2];
  const pair = pearsonPair(X, Y);
  close(pair.r, 0.89732212088352592);
  close(pair.ci!.lower, 0.79360880174744231);
  close(pair.ci!.upper, 0.95036098074705855);
  close(pair.p, 1.8739064820104086e-11);
  assert.ok(pair.ci!.lower > 0);
});

test('a perfect correlation matches R: the interval collapses to the coefficient, p = 0', () => {
  const pair = pearsonPair([1, 2, 3, 4], [2, 4, 6, 8]);
  close(pair.r, 1);
  assert.deepEqual(pair.ci, { lower: 1, upper: 1 });
  assert.equal(pair.p, 0);
  const negative = pearsonPair([1, 2, 3, 4], [8, 6, 4, 2]);
  close(negative.r, -1);
  assert.deepEqual(negative.ci, { lower: -1, upper: -1 });
  assert.equal(negative.p, 0);
});

test('three paired answers give r and p but no interval, as in R', () => {
  const pair = pearsonPair([1, 2, 3], [1, 4, 4]);
  assert.equal(pair.n, 3);
  close(pair.r, 0.8660254037844387);
  close(pair.p, 0.3333333333333333);
  assert.equal(pair.ci, null);
});

test('lists the reason instead of a coefficient when it cannot be computed', () => {
  const few = pearsonPair([1, 2, null], [2, 3, null]);
  assert.equal(few.r, null);
  assert.equal(few.blocker, '成对有效回答不足 3 条（2 条）');
  const constant = pearsonPair([3, 3, 3, 3], [1, 2, 3, 4]);
  assert.equal(constant.r, null);
  assert.equal(constant.blocker, '取值没有变化');
});

const question = (id: string, title: string, type: Question['type'] = 'numeric'): Question => ({
  id,
  title,
  rawTitle: title,
  type,
  included: true,
});

const dataset = {
  questions: [question('x', '每周时长'), question('y', '满意度'), question('z', '开放题', 'open')],
};

test('the correlation uses the paired sample and the sentence names the strongest pair', () => {
  const rows = [
    { x: '1', y: '1' },
    { x: '2', y: '2' },
    { x: '3', y: '3' },
    { x: '4', y: '' },
    { x: '5', y: '5' },
  ];
  const corr = correlationFor(dataset, ['x', 'y', 'z'], rows);
  assert.ok(corr);
  assert.equal(corr.variables.length, 2);
  assert.equal(corr.pairs.length, 1);
  assert.equal(corr.pairs[0].n, 4);
  assert.match(corr.sentence, /2 个变量两两相关，共 1 对/);
  assert.match(corr.sentence, /最强的一对是「每周时长」和「满意度」（r = 1.00，95% 区间 1.00–1.00，n = 4）/);
});

test('scale questions read text levels as numbers', () => {
  const rows = [
    { s: '非常不符合', t: '1' },
    { s: '比较不符合', t: '2' },
    { s: '一般', t: '3' },
    { s: '比较符合', t: '4' },
  ];
  const corr = correlationFor({ questions: [question('s', '量表', 'scale'), question('t', '数值')] }, ['s', 't'], rows);
  assert.ok(corr);
  assert.equal(corr.pairs[0].n, 4);
  assert.ok(corr.pairs[0].r !== null && corr.pairs[0].r > 0.99);
});
