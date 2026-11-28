import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cramersV } from './effects.ts';

const close = (actual: number | null, expected: number, what: string) => {
  assert.ok(actual !== null, `${what}: 没有得到数值`);
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${what}: ${actual} 对 R 的 ${expected}`);
};

// 基准来自仓库外的 R 脚本，以 %.17g 打印：
//   m <- matrix(..., nrow = .., byrow = TRUE)
//   sqrt(suppressWarnings(chisq.test(m, correct = FALSE))$statistic / (sum(m) * min(dim(m) - 1)))
const TABLE_3X4 = [
  [10, 20, 30, 40],
  [15, 25, 10, 5],
  [30, 10, 20, 15],
];
const V_3X4 = 0.32230374827549468;
const TABLE_2X2 = [
  [30, 10],
  [15, 45],
];
const V_2X2 = 0.49236596391733095;
// matrix(c(20, 4, 2, 3, 25, 5, 2, 6, 30), nrow = 3, byrow = TRUE)
const V_3X3 = 0.66371179104033784;

test('a 3x4 table and a 3x3 table match R', () => {
  close(cramersV(TABLE_3X4), V_3X4, '3x4');
  close(
    cramersV([
      [20, 4, 2],
      [3, 25, 5],
      [2, 6, 30],
    ]),
    V_3X3,
    '3x3',
  );
});

test('a 2x2 table matches R and equals phi', () => {
  close(cramersV(TABLE_2X2), V_2X2, '2x2');
  const [[a, b], [c, d]] = TABLE_2X2;
  // phi = (ad − bc) / sqrt((a+b)(c+d)(a+c)(b+d))；R 里同一个数打印成 0.4923659639173309。
  const phi = (a * d - b * c) / Math.sqrt((a + b) * (c + d) * (a + c) * (b + d));
  close(phi, V_2X2, 'phi');
  close(cramersV(TABLE_2X2), phi, 'V 对 phi');
});

test('perfect association gives 1 and independent rows give 0', () => {
  // matrix(c(10, 0, 0, 0, 12, 0, 0, 0, 15), nrow = 3) 与 matrix(c(10, 0, 0, 10), nrow = 2) 都是 1
  close(
    cramersV([
      [10, 0, 0],
      [0, 12, 0],
      [0, 0, 15],
    ]),
    1,
    '完全关联',
  );
  close(
    cramersV([
      [10, 0],
      [0, 10],
    ]),
    1,
    '完全关联',
  );
  // matrix(c(10, 20, 30, 6, 12, 18, 4, 8, 12), nrow = 3, byrow = TRUE)
  close(
    cramersV([
      [10, 20, 30],
      [6, 12, 18],
      [4, 8, 12],
    ]),
    0,
    '行列独立',
  );
});

test('fewer than two rows or columns, no observations, or a broken cell give no effect size', () => {
  assert.equal(cramersV([[10, 20, 30]]), null);
  assert.equal(
    cramersV([
      [10],
      [20],
    ]),
    null,
  );
  assert.equal(cramersV([]), null);
  assert.equal(cramersV([[]]), null);
  assert.equal(
    cramersV([
      [0, 0],
      [0, 0],
    ]),
    null,
  );
  assert.equal(
    cramersV([
      [10, NaN],
      [20, 30],
    ]),
    null,
  );
});

test('a row or column nobody chose adds nothing instead of breaking the sum', () => {
  // R 的 chisq.test 对零边际的表给出 NaN；期望频数为 0 的格子观测也必为 0，跳过它即可。
  close(
    cramersV([
      [10, 20, 0],
      [20, 40, 0],
    ]),
    0,
    '空列',
  );
  close(
    cramersV([
      [10, 0],
      [0, 10],
      [0, 0],
    ]),
    1,
    '空行',
  );
});

test('the table is left as it was', () => {
  const before = structuredClone(TABLE_3X4);
  cramersV(TABLE_3X4);
  assert.deepEqual(TABLE_3X4, before);
});
