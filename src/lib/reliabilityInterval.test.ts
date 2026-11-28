import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cronbachAlpha } from './reliability.ts';
import { alphaInterval } from './reliabilityInterval.ts';

// 基准来自仓库外的 R 脚本 /tmp/readout-r-reliability/alpha.R：set.seed(20261128)，单因子生成的 5 题量表，n = 40，取值 1–5。
const x1 = [3, 3, 2, 2, 2, 5, 1, 2, 5, 3, 5, 3, 4, 1, 1, 3, 2, 3, 4, 4, 5, 1, 5, 2, 2, 1, 4, 5, 5, 1, 4, 1, 3, 1, 4, 3, 5, 1, 4, 2];
const x2 = [4, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 4, 3, 1, 5, 1, 5, 5, 2, 5, 3, 3, 4, 3, 1, 2, 5, 5, 3, 5, 1, 5, 2, 5, 3, 5, 1, 3, 1];
const x3 = [3, 1, 4, 3, 1, 3, 2, 3, 3, 3, 3, 1, 5, 2, 1, 3, 2, 5, 5, 4, 5, 2, 1, 3, 3, 1, 4, 5, 5, 1, 5, 1, 3, 2, 4, 1, 5, 3, 2, 1];
const x4 = [5, 1, 4, 4, 1, 5, 2, 1, 5, 4, 3, 3, 5, 1, 1, 4, 1, 4, 5, 2, 4, 3, 2, 3, 4, 1, 2, 5, 5, 3, 5, 1, 1, 2, 2, 3, 5, 1, 2, 1];
const x5 = [3, 1, 1, 3, 3, 5, 2, 2, 4, 2, 3, 1, 4, 2, 2, 1, 3, 2, 5, 1, 4, 4, 5, 4, 1, 1, 5, 5, 5, 1, 3, 1, 4, 2, 2, 5, 3, 1, 2, 2];
const cols = [x1, x2, x3, x4, x5];

// R（psych::alpha 的求和方差公式）：5 / 4 * (1 - sum(apply(X, 2, var)) / var(rowSums(X)))。
const R_ALPHA = 0.85872279367918902;
// R 端用同一算法（按行有放回重抽样、type-7 的 2.5% 与 97.5% 分位）做 200 次 × 2000 次重抽样得到的端点均值与标准差。
// 两侧的伪随机数发生器不同，所以只要求 TS 的端点落在均值附近若干个标准差之内。
const R_LOWER = { mean: 0.75834363868466692, sd: 0.0040051897469283813 };
const R_UPPER = { mean: 0.91458659032110723, sd: 0.0015223593628194956 };

const close = (actual: number | null | undefined, expected: number, tol = 1e-9) => {
  assert.ok(actual !== null && actual !== undefined, `expected ${expected}, got nothing`);
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} vs R ${expected}`);
};

test('the point alpha matches R, and the bootstrap interval is reproducible and covers it', () => {
  const alpha = cronbachAlpha(cols);
  close(alpha, R_ALPHA);

  const ci = alphaInterval(cols);
  assert.ok(ci);
  assert.ok(Number.isFinite(ci.lower) && Number.isFinite(ci.upper));
  assert.ok(ci.lower < alpha! && alpha! < ci.upper, `${ci.lower}–${ci.upper} around ${alpha}`);
  assert.deepEqual(alphaInterval(cols), ci);
  // 重抽样只按行进行，与题目顺序无关；换序后 α 只差舍入（cronbachAlpha 按列序累加方差）。
  const reordered = alphaInterval([x5, x1, x3, x2, x4])!;
  close(reordered.lower, ci.lower, 1e-12);
  close(reordered.upper, ci.upper, 1e-12);

  // 容差取 R 端端点标准差的 5 倍。
  assert.ok(Math.abs(ci.lower - R_LOWER.mean) <= 5 * R_LOWER.sd, `lower ${ci.lower} vs R ${R_LOWER.mean} ± ${R_LOWER.sd}`);
  assert.ok(Math.abs(ci.upper - R_UPPER.mean) <= 5 * R_UPPER.sd, `upper ${ci.upper} vs R ${R_UPPER.mean} ± ${R_UPPER.sd}`);
});

test('fewer than 5 rows, fewer than 2 items, or an undefined alpha gives no interval', () => {
  assert.equal(alphaInterval(cols.map((c) => c.slice(0, 4))), null);
  assert.equal(alphaInterval([[]]), null);
  assert.equal(alphaInterval([]), null);
  assert.equal(alphaInterval([x1]), null);
  // 每份问卷的作答都一样：总分没有方差，α 本身算不出。
  const same = Array.from({ length: 5 }, () => Array(10).fill(3));
  assert.equal(cronbachAlpha(same), null);
  assert.equal(alphaInterval(same), null);
  assert.equal(alphaInterval([x1, [...x2.slice(0, 39), NaN]]), null);
  assert.equal(alphaInterval([x1, x2.slice(0, 39)]), null);
});
