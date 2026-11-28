import assert from 'node:assert/strict';
import test from 'node:test';
import { averageRanks, kruskalWallis, mannWhitneyU, spearmanPair } from './ranks.ts';

// 基准数值来自仓库外的 R 脚本（base/stats）：
//   wilcox.test(x, y, exact = FALSE, correct = TRUE)
//   kruskal.test(list(g1, g2, g3))
//   对秩做 Pearson 并按 t 近似算 p、Fisher z 算区间（与 cor.test(method = "spearman", exact = FALSE) 同口径）

const close = (actual: number | null, expected: number, tol = 1e-9) => {
  assert.ok(actual !== null, `got null, want ${expected}`);
  assert.ok(Math.abs(actual - expected) <= tol, `got ${actual}, want ${expected}`);
};

test('average ranks share ties', () => {
  assert.deepEqual(averageRanks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
});

test('Mann–Whitney U matches R with ties and continuity correction', () => {
  const x = [3, 4, 4, 5, 5, 5, 6, 7, 7, 8, 9, 9];
  const y = [2, 3, 3, 4, 5, 5, 6, 6, 8];
  const result = mannWhitneyU(x, y);
  assert.ok(result);
  close(result.u, 73.5, 1e-12);
  close(result.p, 0.17197606799203902, 1e-12);
  assert.ok(result.r > 0 && result.r < 1);
  assert.equal(mannWhitneyU([], y), null);
  assert.equal(mannWhitneyU([2, 2, 2], [2, 2]), null);
});

test('Kruskal–Wallis matches R with ties', () => {
  const groups = [
    [3, 4, 4, 5, 5, 6, 7, 8, 8, 9],
    [2, 3, 4, 4, 5, 5, 6, 7, 7, 8, 9, 10],
    [5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 11],
  ];
  const result = kruskalWallis(groups);
  assert.ok(result);
  close(result.h, 5.2444362155156314, 1e-12);
  assert.equal(result.df, 2);
  close(result.p, 0.072641557195379111, 1e-12);
  close(result.epsilon2, (5.2444362155156314 - 3 + 1) / (33 - 3), 1e-12);
  assert.equal(kruskalWallis([[1, 2, 3]]), null);
  assert.equal(kruskalWallis([[2, 2, 2], [2, 2]]), null);
});

test('Spearman matches the R rank-correlation numbers', () => {
  const x = [1, 2, 2, 3, 3, 3, 4, 5, 5, 6, 7, 7, 8, 9, 9, 10];
  const y = [2, 1, 3, 2, 4, 4, 5, 4, 6, 6, 7, 6, 8, 8, 9, 10];
  const result = spearmanPair(x, y);
  assert.equal(result.n, 16);
  close(result.r, 0.9575271438270565, 1e-12);
  close(result.p, 5.9741930743694073e-09, 1e-9);
  close(result.ci?.lower ?? null, 0.87907673818137011, 1e-12);
  close(result.ci?.upper ?? null, 0.98547532228832035, 1e-12);
});

test('Spearman drops incomplete pairs and reports blockers', () => {
  const partial = spearmanPair([1, 2, 3, 4, null], [2, 4, 6, 8, 10]);
  assert.equal(partial.n, 4);
  close(partial.r, 1, 1e-12);
  const three = spearmanPair([1, 2, 3], [1, 4, 4]);
  assert.equal(three.ci, null);
  assert.ok(three.p !== null);
  const two = spearmanPair([1, 2, null], [1, 2, null]);
  assert.match(two.blocker ?? '', /不足 3 条/);
  const flat = spearmanPair([1, 2, 3, 4], [7, 7, 7, 7]);
  assert.equal(flat.r, null);
  assert.equal(flat.blocker, '取值没有变化');
});
