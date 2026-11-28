import assert from 'node:assert/strict';
import test from 'node:test';
import { bartlett, correlationMatrix, invertMatrix, kmo, singleFactorOmega } from './factor.ts';
import { alphaInterval } from './reliabilityInterval.ts';
import { cronbachAlpha } from './reliability.ts';

// 基准：/tmp/pro-r/ref.R —— set.seed(7)、n = 60、5 个单因子题目的相关矩阵，用 base R 的
// solve() / determinant() / eigen() 按 KMO、Bartlett、第一主成分 ω 的公式算出。
const R = [
  [1, 0.6511392131826651, 0.72685318961701961, 0.50200168760228547, 0.72791516011399748],
  [0.6511392131826651, 1, 0.68261897378963943, 0.39435305093805567, 0.68113583063259697],
  [0.72685318961701961, 0.68261897378963943, 1, 0.47622255489765714, 0.8066036600708516],
  [0.50200168760228547, 0.39435305093805567, 0.47622255489765714, 1, 0.49118929614282847],
  [0.72791516011399748, 0.68113583063259697, 0.8066036600708516, 0.49118929614282847, 1],
];

const close = (actual: number | null, expected: number, tol = 1e-6) => {
  assert.ok(actual !== null, `got null, want ${expected}`);
  assert.ok(Math.abs(actual - expected) <= tol, `got ${actual}, want ${expected}`);
};

test('correlation matrix and inverse behave', () => {
  const cols = [
    [1, 2, 3, 4, 5],
    [2, 4, 6, 8, 11],
    [5, 4, 3, 2, 1],
  ];
  const corr = correlationMatrix(cols);
  assert.ok(corr);
  close(corr[0][0], 1, 1e-12);
  close(corr[0][1], corr[1][0], 1e-12);
  const inv = invertMatrix(R);
  assert.ok(inv);
  // 乘法近似单位矩阵
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const dot = R[i].reduce((s, x, k) => s + x * inv[k][j], 0);
      close(dot, i === j ? 1 : 0, 1e-9);
    }
  }
  assert.equal(invertMatrix([[1, 2], [2, 4]]), null);
  assert.equal(correlationMatrix([[1, 1, 1], [1, 2, 3]]), null);
});

test('KMO and Bartlett match base R', () => {
  close(kmo(R), 0.87159260901760272);
  const b = bartlett(R, 60);
  assert.ok(b);
  close(b.chi2, 172.42339125200218, 1e-6);
  assert.equal(b.df, 10);
  close(b.p, 8.7331668812238743e-32, 1e-30);
  assert.equal(bartlett(R, 5), null);
});

test('single-factor omega matches the first-component formula', () => {
  close(singleFactorOmega(R), 0.9195144915878225, 1e-6);
  assert.equal(singleFactorOmega([[1, 2], [2, 1]]), singleFactorOmega([[1, 2], [2, 1]]));
});

test('alpha interval is reproducible and brackets the point estimate', () => {
  const cols = [
    [4, 5, 4, 3, 5, 4, 5, 4, 3, 4, 5, 4],
    [3, 4, 3, 3, 4, 4, 4, 3, 2, 3, 4, 4],
    [4, 4, 5, 4, 5, 5, 4, 4, 4, 4, 5, 5],
    [3, 3, 4, 2, 4, 3, 4, 3, 3, 3, 4, 3],
    [5, 5, 4, 4, 5, 4, 5, 4, 4, 4, 5, 4],
  ];
  const first = alphaInterval(cols);
  assert.ok(first);
  assert.deepEqual(alphaInterval(cols), first);
  const alpha = cronbachAlpha(cols);
  assert.ok(alpha !== null);
  assert.ok(first.lower < alpha && alpha < first.upper, `${first.lower} < ${alpha} < ${first.upper}`);
  assert.equal(alphaInterval(cols.map((c) => c.slice(0, 4))), null);
});
