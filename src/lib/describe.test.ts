import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distributionShape, kurtosis, skewness } from './describe.ts';

// 基准来自仓库外的 R 脚本，用 base R 写出 type 2 公式（e1071 的默认口径），以 %.17g 打印：
//   skew2 <- function(x) { n <- length(x); m <- mean(x); s <- sqrt(sum((x - m)^2) / (n - 1)); z <- (x - m) / s
//                         n / ((n - 1) * (n - 2)) * sum(z^3) }
//   kurt2 <- function(x) { n <- length(x); m <- mean(x); s <- sqrt(sum((x - m)^2) / (n - 1)); z <- (x - m) / s
//                         n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * sum(z^4) - 3 * (n - 1)^2 / ((n - 2) * (n - 3)) }
const close = (actual: number | null, expected: number, what: string) => {
  assert.ok(actual !== null, `${what}: 没有得到数值`);
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${what}: ${actual} 对 R 的 ${expected}`);
};

// 右偏：大部分落在 2–6，少数拖到 12 以上。
const SKEWED = [2.1, 3.4, 1.8, 2.9, 12.5, 4.2, 3.1, 2.6, 1.9, 25.3, 3.8, 2.2, 5.6, 2.4, 3.0, 48.7];
const SKEWED_SKEW = 2.8608585809356906; // skew2(skewed)
const SKEWED_KURTOSIS = 8.3812863506167261; // kurt2(skewed)
const SKEWED_SKEW_SE = 0.61237243569579447; // sqrt(6 / 16)
const SKEWED_KURTOSIS_SE = 1.2247448713915889; // sqrt(24 / 16)

// 对称：每个数都和它的相反数成对出现。
const SYMMETRIC = [-2.3, -1.1, -0.5, 0.2, 1.4, 0.9, -0.8, 2.3, 1.1, 0.5, -0.2, -1.4, -0.9, 0.8];
const SYMMETRIC_SKEW = 0; // skew2(sym)
const SYMMETRIC_KURTOSIS = -0.41982148474362946; // kurt2(sym)
const SYMMETRIC_SKEW_SE = 0.65465367070797709; // sqrt(6 / 14)
const SYMMETRIC_KURTOSIS_SE = 1.3093073414159542; // sqrt(24 / 14)

// 刚好 8 个：distributionShape 给出结果的最小样本。
const EIGHT = [1.5, 2.5, 3.0, 2.0, 7.0, 1.0, 4.5, 3.5];
const EIGHT_SKEW = 1.2136281073863238; // skew2(eight)
const EIGHT_KURTOSIS = 1.5784919134635569; // kurt2(eight)
const EIGHT_SKEW_SE = 0.8660254037844386; // sqrt(6 / 8)
const EIGHT_KURTOSIS_SE = 1.7320508075688772; // sqrt(24 / 8)

test('skewness and kurtosis match the type 2 formulas in R on skewed and symmetric data', () => {
  close(skewness(SKEWED), SKEWED_SKEW, '偏度');
  close(kurtosis(SKEWED), SKEWED_KURTOSIS, '峰度');
  close(skewness(SYMMETRIC), SYMMETRIC_SKEW, '偏度');
  close(kurtosis(SYMMETRIC), SYMMETRIC_KURTOSIS, '峰度');
});

test('symmetric data has skewness 0, negating the data flips its sign', () => {
  assert.ok(Math.abs(skewness(SYMMETRIC)!) < 1e-9, '对称数据的偏度应当是 0');
  // skew2(-skewed)；峰度不受正负号影响。
  close(skewness(SKEWED.map((x) => -x)), -SKEWED_SKEW, '偏度');
  close(kurtosis(SKEWED.map((x) => -x)), SKEWED_KURTOSIS, '峰度');
  // skew2(1:4) 与 kurt2(1:4)
  close(skewness([1, 2, 3, 4]), 0, '偏度');
  close(kurtosis([1, 2, 3, 4]), -1.2, '峰度');
});

test('distributionShape carries the same moments plus the standard errors sqrt(6/n) and sqrt(24/n)', () => {
  const skewed = distributionShape(SKEWED)!;
  assert.equal(skewed.n, 16);
  close(skewed.skew, SKEWED_SKEW, '偏度');
  close(skewed.kurtosis, SKEWED_KURTOSIS, '峰度');
  close(skewed.skewSE, SKEWED_SKEW_SE, '偏度标准误');
  close(skewed.kurtosisSE, SKEWED_KURTOSIS_SE, '峰度标准误');

  const symmetric = distributionShape(SYMMETRIC)!;
  assert.equal(symmetric.n, 14);
  close(symmetric.skew, SYMMETRIC_SKEW, '偏度');
  close(symmetric.kurtosis, SYMMETRIC_KURTOSIS, '峰度');
  close(symmetric.skewSE, SYMMETRIC_SKEW_SE, '偏度标准误');
  close(symmetric.kurtosisSE, SYMMETRIC_KURTOSIS_SE, '峰度标准误');

  const eight = distributionShape(EIGHT)!;
  assert.equal(eight.n, 8);
  close(eight.skew, EIGHT_SKEW, '偏度');
  close(eight.kurtosis, EIGHT_KURTOSIS, '峰度');
  close(eight.skewSE, EIGHT_SKEW_SE, '偏度标准误');
  close(eight.kurtosisSE, EIGHT_KURTOSIS_SE, '峰度标准误');

  // 右偏数据的标准误用法：偏度、峰度都超过两倍标准误。
  assert.ok(Math.abs(skewed.skew) > 2 * skewed.skewSE);
  assert.ok(Math.abs(skewed.kurtosis) > 2 * skewed.kurtosisSE);
});

test('fewer than four values or no variation gives no skewness, kurtosis or shape', () => {
  for (const xs of [[], [1, 2, 3], [2, 2, 2, 2, 2]]) {
    assert.equal(skewness(xs), null);
    assert.equal(kurtosis(xs), null);
    assert.equal(distributionShape(xs), null);
  }
  // 四个值刚好够：skew2(c(1, 2, 3, 8)) 与 kurt2(c(1, 2, 3, 8))
  close(skewness([1, 2, 3, 8]), 1.5970779829307844, '偏度');
  close(kurtosis([1, 2, 3, 8]), 2.7039239001189124, '峰度');
});

test('distributionShape needs at least eight values', () => {
  assert.equal(distributionShape([1, 2, 3, 8]), null);
  assert.equal(distributionShape(EIGHT.slice(0, 7)), null);
  assert.equal(distributionShape(EIGHT.slice(1)), null);
  assert.equal(distributionShape(EIGHT)!.n, 8);
});

test('NaN or infinity in the data gives null instead of a NaN result', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const xs = [...EIGHT.slice(0, 7), bad];
    assert.equal(skewness(xs), null);
    assert.equal(kurtosis(xs), null);
    assert.equal(distributionShape(xs), null);
  }
});
