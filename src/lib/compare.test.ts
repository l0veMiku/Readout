import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Question, QuestionType } from '../types.ts';
import type { Diff } from './compare.ts';
import { canCompare, chisqTest, compareQuestions, fisherTwoRows, formatTest, independenceTest, newcombeInterval, welchDiff, withMedianIntervals } from './compare.ts';
import { bootstrapIntervals } from './intervals.ts';
import { hours, welchA, welchB } from './refdata.ts';

const close = (actual: number | null | undefined, expected: number, tol = 1e-9) => {
  assert.ok(actual !== null && actual !== undefined, `expected ${expected}, got nothing`);
  assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${actual} vs R ${expected}`);
};

const mk = (id: string, type: QuestionType, title = id): Question => ({ id, title, rawTitle: title, type, included: true });

// 行 = 组，列 = 选项；数值与仓库外 R 脚本的矩阵一致。
const M_OK = [[30, 18, 40, 20], [25, 12, 33, 15], [42, 9, 30, 10]];
const M_SMALL = [[20, 2, 10], [5, 14, 1]];
const M_SPARSE = [[30, 20, 25], [5, 10, 8], [2, 1, 3]];
const M_2X2 = [[30, 45], [20, 12]];

test('Newcombe interval for a difference of proportions matches R', () => {
  const cases: [number, number, number, number, number, number][] = [
    [56, 70, 48, 80, 0.052431472402365, 0.333872654036906],
    [42, 128, 30, 60, -0.315792766257918, -0.0224731023314037],
    [8, 10, 2, 12, 0.21480602884507, 0.820064318108908],
    [0, 15, 4, 20, -0.416017432251893, 0.0362435056084966],
    [10, 10, 60, 80, -0.0393756013159538, 0.35484674619234],
    [5, 9, 41, 45, -0.649422398556315, -0.0737848614446406],
  ];
  for (const [a, n1, b, n2, lower, upper] of cases) {
    const ci = newcombeInterval(a, n1, b, n2);
    close(ci?.lower, lower, 1e-10);
    close(ci?.upper, upper, 1e-10);
  }
  assert.equal(newcombeInterval(3, 0, 4, 9), null);
});

test('Welch difference, interval, p value and Cohen\'s d match R t.test(var.equal = FALSE)', () => {
  const w = welchDiff(welchB, welchA);
  assert.ok(w);
  close(w.diff, 0.116666666666667);
  close(w.lower, -0.559103651154043);
  close(w.upper, 0.792436984487376);
  close(w.p, 0.730591792015847);
  close(w.df, 53.9973983929462);
  close(w.t, 0.346127723503904);
  close(w.d, 0.0772564462458901);

  const h = welchDiff(hours, welchB);
  assert.ok(h);
  close(h.diff, 2.18133333333333);
  close(h.lower, 1.43581728823132);
  close(h.upper, 2.92684937843535);
  close(h.p, 1.11450634575741e-7);
  close(h.df, 81.4272613920641);
  close(h.d, 0.622637967266081);

  assert.equal(welchDiff([4], [1, 2, 3]), null);
  assert.equal(welchDiff([1, 2, 3], [4]), null);
  assert.equal(welchDiff([5, 5, 5], [1, 2, 3]), null);
  assert.equal(welchDiff([1, 2, 3], [5, 5, 5]), null);
});

test('chi-square statistic, degrees of freedom and expected counts match R chisq.test(correct = FALSE)', () => {
  const expected = {
    ok: [9.80614256002898, 6, 0.133056758449948, 11.6725352112676, 0],
    small: [23.8653409090909, 2, 6.57214394969472e-06, 4.23076923076923, 1 / 6],
    two: [4.56157894736842, 1, 0.032696915955165, 14.9532710280374, 0],
    sparse: [4.14275565888469, 4, 0.387030582646932, 1.78846153846154, 1 / 3],
  };
  for (const [m, [statistic, df, p, minExpected, lowCells]] of [
    [M_OK, expected.ok],
    [M_SMALL, expected.small],
    [M_2X2, expected.two],
    [M_SPARSE, expected.sparse],
  ] as const) {
    const r = chisqTest(m.map((row) => [...row]))!;
    close(r.statistic, statistic, 1e-9);
    assert.equal(r.df, df);
    close(r.p, p, 1e-6);
    close(r.minExpected, minExpected, 1e-9);
    close(r.lowCells, lowCells, 1e-12);
  }
  assert.equal(chisqTest([[10, 0], [5, 0]]), null);
  assert.equal(chisqTest([[10, 4]]), null);
});

test('Yates continuity correction matches R chisq.test(correct = TRUE)', () => {
  const r = chisqTest([[10, 20], [30, 40]], true)!;
  close(r.statistic, 0.446428571428571, 1e-12);
  close(r.p, 0.504035866452505, 1e-12);
  assert.equal(r.df, 1);
});

test('independence test picks chi-square or Fisher and flags sparse tables', () => {
  const ok = independenceTest(M_OK)!;
  assert.equal(ok.method, 'chisq');
  assert.equal(ok.unreliable, false);
  close(ok.p, 0.133056758449948, 1e-6);

  const two = independenceTest(M_2X2)!;
  assert.equal(two.method, 'chisq');
  assert.equal(two.unreliable, false);

  const sparse = independenceTest(M_SPARSE)!;
  assert.equal(sparse.method, 'chisq');
  assert.equal(sparse.unreliable, true);

  const small = independenceTest(M_SMALL)!;
  assert.equal(small.method, 'fisher');
  assert.equal(small.unreliable, false);
  close(small.p, 0.00000422766358298665, 1e-6);
  close(small.statistic, 23.8653409090909, 1e-9);
});

test('sparse tests carry the unreliable note wherever they are printed', () => {
  const sparse = independenceTest(M_SPARSE)!;
  assert.equal(sparse.unreliable, true);
  assert.match(formatTest(sparse), /部分类别人数过少，检验结果仅供参考/);
  const ok = independenceTest(M_OK)!;
  assert.doesNotMatch(formatTest(ok), /仅供参考/);
});

test('Fisher exact p values match R fisher.test for 2x2, 2x3 and 2x4 tables', () => {
  const cases: [number[][], number][] = [
    [[[8, 5], [2, 15]], 0.00688703267413913],
    [[[7, 0], [3, 6]], 0.0113636363636364],
    [[[8, 5, 3], [2, 15, 9]], 0.0117198357743008],
    [[[12, 1, 0, 5], [3, 6, 4, 9]], 0.00222310585633163],
  ];
  close(fisherTwoRows([120, 45], [200, 205]), 6.2255622638239e-15, 1e-6);
  close(fisherTwoRows([12, 9], [16, 29]), 0.00619930856148447, 1e-6);
  close(fisherTwoRows([12, 1, 0, 5], [15, 7, 4, 14]), 0.00222310585633163, 1e-6);
  for (const [m, p] of cases) {
    const r = independenceTest(m)!;
    assert.equal(r.method, 'fisher');
    close(r.p, p, 1e-6);
  }
});

test('only a single-choice grouping question and a closed question can be compared', () => {
  assert.equal(canCompare(mk('g', 'single'), mk('c', 'single')), true);
  assert.equal(canCompare(mk('g', 'multi'), mk('c', 'single')), false);
  assert.equal(canCompare(mk('g', 'single'), mk('c', 'open')), false);
  assert.equal(canCompare(mk('g', 'single'), mk('g', 'single')), false);
  assert.equal(canCompare({ ...mk('g', 'single'), included: false }, mk('c', 'single')), false);
  assert.equal(canCompare(null, mk('c', 'single')), false);
  assert.equal(compareQuestions(mk('g', 'scale'), mk('c', 'single'), []), null);
});

test('single-choice comparison: group counts, intervals, differences against the first group and one chi-square test', () => {
  const g = mk('g', 'single');
  const c = mk('c', 'single');
  const rows = [
    ...Array.from({ length: 14 }, () => ({ g: '甲', c: '满意' })),
    ...Array.from({ length: 6 }, () => ({ g: '甲', c: '一般' })),
    ...Array.from({ length: 4 }, () => ({ g: '乙', c: '满意' })),
    ...Array.from({ length: 12 }, () => ({ g: '乙', c: '一般' })),
    { g: '乙', c: '' },
    { g: '丙', c: '-' },
  ];
  const r = compareQuestions(g, c, rows)!;
  assert.equal(r.mode, 'prop');
  assert.equal(r.multi, false);
  assert.equal(r.n, 36);
  assert.deepEqual(r.groups, [{ name: '甲', n: 20 }, { name: '乙', n: 16 }]);
  assert.deepEqual(r.rows.map((x) => x.name), ['满意', '一般']);

  const row = r.rows[1];
  assert.deepEqual(row.cells.map((cell) => cell.kind === 'prop' && [cell.count, cell.pct]), [[6, 0.3], [12, 0.75]]);
  const nc = newcombeInterval(12, 16, 6, 20)!;
  close(row.diffs[0]!.diff, 0.45, 1e-15);
  close(row.diffs[0]!.lower, nc.lower, 1e-15);
  close(row.diffs[0]!.upper, nc.upper, 1e-15);
  assert.equal(row.diffs.length, 1);

  assert.equal(r.test?.method, 'chisq');
  close(r.test?.p, 0.00729035809153564, 1e-9);
  close(r.test?.statistic, 7.2, 1e-9);
  assert.equal(r.test?.df, 1);
  assert.equal(r.test?.unreliable, false);
  assert.ok(r.rows.every((x) => x.test === null));
  assert.match(r.sentence, /^相对基准组「甲」，差别最大的一处是「一般」的占比：乙 高 45\.0 个百分点（95% 区间 [\d.]+–[\d.]+）；2 处区间不含 0，0 处没有看到明确差别。整体分布检验：卡方 = 7\.20，df = 1，p = 0\.007（Pearson，未做 Yates 校正）。$/);
  assert.match(row.sentence, /^「一般」：乙 高 45\.0 个百分点（95% 区间 [\d.]+–[\d.]+）。$/);
  assert.doesNotMatch(`${r.sentence}${row.sentence}`, /显著/);
});

test('when every interval covers 0 the conclusion says no clear difference and still gives the numbers', () => {
  const rows = [
    ...Array.from({ length: 6 }, () => ({ g: '男', c: '是' })),
    ...Array.from({ length: 6 }, () => ({ g: '男', c: '否' })),
    ...Array.from({ length: 6 }, () => ({ g: '女', c: '是' })),
    ...Array.from({ length: 4 }, () => ({ g: '女', c: '否' })),
  ];
  const r = compareQuestions(mk('g', 'single'), mk('c', 'single'), rows)!;
  assert.ok(r.rows.every((x) => x.diffs.every((d) => d && d.lower < 0 && d.upper > 0)));
  assert.match(r.sentence, /^相对基准组「男」，各选项的占比都没有看到明确差别（所有区间都包含 0）。整体分布检验：.+。$/);
  const d = r.rows.find((x) => x.name === '是')!.diffs[0]!;
  close(d.diff, 0.1, 1e-15);
  assert.match(r.rows.find((x) => x.name === '是')!.sentence, /^「是」：女 没有看到明确差别（高 10\.0 个百分点，95% 区间 -[\d.]+ 至 [\d.]+）。$/);
});

test('more than two groups compare each group with the first one', () => {
  const rows = [
    ...Array.from({ length: 6 }, () => ({ g: '大一', c: '是' })),
    ...Array.from({ length: 6 }, () => ({ g: '大一', c: '否' })),
    ...Array.from({ length: 2 }, () => ({ g: '大二', c: '是' })),
    ...Array.from({ length: 8 }, () => ({ g: '大二', c: '否' })),
    { g: '大三', c: '是' },
  ];
  const r = compareQuestions(mk('g', 'single'), mk('c', 'single'), rows)!;
  assert.deepEqual(r.groups.map((x) => x.name), ['大一', '大二', '大三']);
  const row = r.rows.find((x) => x.name === '是')!;
  assert.deepEqual(row.cells.map((cell) => cell.kind === 'prop' && cell.count), [6, 2, 1]);
  const [a, b] = row.diffs as [Diff, Diff];
  close(a.diff, -0.3, 1e-15);
  close(a.lower, newcombeInterval(2, 10, 6, 12)!.lower, 1e-15);
  close(b.diff, 0.5, 1e-15);
  close(b.upper, newcombeInterval(1, 1, 6, 12)!.upper, 1e-15);
  assert.equal(r.test?.df, 2);
  assert.equal(r.test?.unreliable, true);
  assert.match(r.sentence, /部分类别人数过少，检验结果仅供参考/);
});

test('multi-select compares each option against the group size and tests options separately', () => {
  const g = mk('g', 'single');
  const c = mk('c', 'multi');
  const rows = [
    ...Array.from({ length: 4 }, () => ({ g: '甲', c: 'A┋B' })),
    ...Array.from({ length: 2 }, () => ({ g: '甲', c: 'A' })),
    ...Array.from({ length: 4 }, () => ({ g: '甲', c: 'B' })),
    ...Array.from({ length: 2 }, () => ({ g: '乙', c: 'A' })),
    ...Array.from({ length: 9 }, () => ({ g: '乙', c: 'B' })),
  ];
  const r = compareQuestions(g, c, rows)!;
  assert.equal(r.multi, true);
  assert.equal(r.test, null);
  const byName = Object.fromEntries(r.rows.map((x) => [x.name, x]));
  assert.deepEqual(r.rows.map((x) => x.name), ['B', 'A']);
  assert.deepEqual(r.groups, [{ name: '乙', n: 11 }, { name: '甲', n: 10 }]);
  assert.deepEqual(byName.B.cells.map((cell) => cell.kind === 'prop' && [cell.count, cell.pct]), [[9, 9 / 11], [8, 0.8]]);
  assert.deepEqual(byName.A.cells.map((cell) => cell.kind === 'prop' && [cell.count, cell.pct]), [[2, 2 / 11], [6, 0.6]]);
  assert.ok(byName.A.cells[1].kind === 'prop' && byName.B.cells[1].kind === 'prop' && byName.A.cells[1].pct + byName.B.cells[1].pct > 1);
  close(byName.A.diffs[0]!.diff, 0.6 - 2 / 11, 1e-15);
  assert.equal(byName.A.test?.method, 'fisher');
  close(byName.A.test?.p, 0.0804953560371516, 1e-9);
  assert.equal(byName.B.test?.method, 'fisher');
  assert.match(r.sentence, /未做多重比较校正/);
});

test('scale and numeric comparisons give a mean interval per group and a Welch difference against the first group', () => {
  const g = mk('g', 'single');
  const rows = [
    ...[3, 4, 5, 3, 4].map((v) => ({ g: '大一', c: String(v) })),
    ...[5, 5, 4, 5, 5, 4].map((v) => ({ g: '大二', c: String(v) })),
    { g: '大三', c: '4' },
    { g: '大三', c: '' },
  ];
  const s = compareQuestions(g, mk('c', 'scale'), rows)!;
  assert.equal(s.mode, 'mean');
  assert.equal(s.rows.length, 1);
  const cells = s.rows[0].cells;
  assert.ok(cells.every((cell) => cell.kind === 'mean'));
  const [a, b, c3] = cells;
  assert.ok(a?.kind === 'mean' && b?.kind === 'mean' && c3?.kind === 'mean');
  assert.deepEqual(s.groups.map((x) => x.name), ['大二', '大一', '大三']);
  assert.deepEqual([a.n, b.n, c3.n], [6, 5, 1]);
  close(a.mean, 28 / 6);
  close(b.mean, 3.8);
  close(b.meanCI!.lower, 2.761149, 1e-6);
  close(b.meanCI!.upper, 4.838851, 1e-6);
  assert.equal(a.median, null);
  assert.equal(c3.meanCI, null);
  const w = s.rows[0].diffs[0]!;
  close(w.diff, -0.866666666666667);
  close(w.lower, -1.900926348606346);
  close(w.upper, 0.167593015273012);
  close(w.p, 0.0870154095418349);
  close(w.d, -1.27886037977871);
  assert.equal(s.rows[0].diffs[1], null);
  assert.match(s.sentence, /^各组在「c」上的均值没有看到明确差别（相对基准组「大二」）：大一 没有看到明确差别（低 0\.87 分，95% 区间 -1\.90 至 0\.17）。$/);

  const n = compareQuestions(g, mk('c', 'numeric'), rows)!;
  const cell = n.rows[0].cells[0];
  assert.deepEqual(cell?.kind === 'mean' && [cell.median, cell.medianCI?.lower, cell.medianCI?.upper], [5, 4, 5]);
});

test('a clear difference in means is stated with its size and interval, never with a bare p value', () => {
  const rows = [...welchA.map((v) => ({ g: '甲', c: String(v) })), ...hours.map((v) => ({ g: '乙', c: String(v) }))];
  const r = compareQuestions(mk('g', 'single'), mk('c', 'numeric'), rows)!;
  const d = r.rows[0].diffs[0]!;
  const ref = welchDiff(welchA, hours)!;
  close(d.diff, ref.diff, 1e-15);
  close(d.lower, ref.lower, 1e-15);
  close(d.upper, ref.upper, 1e-15);
  close(d.p, ref.p, 1e-15);
  assert.match(r.sentence, /^各组在「c」上的均值存在差别（相对基准组「乙」）：甲 低 2\.30（95% 区间 -2\.79 至 -1\.81）。$/);
  assert.doesNotMatch(r.sentence, /显著/);
});

test('comparisons that cannot be made say so instead of showing numbers', () => {
  const g = mk('g', 'single');
  const empty = compareQuestions(g, mk('c', 'single'), [])!;
  assert.equal(empty.rows.length, 0);
  assert.match(empty.sentence, /没有同时有效回答/);
  const one = compareQuestions(g, mk('c', 'single'), [{ g: '大一', c: '是' }, { g: '大一', c: '否' }])!;
  assert.deepEqual(one.groups, [{ name: '大一', n: 2 }]);
  assert.match(one.sentence, /只有一组/);
  const same = compareQuestions(g, mk('c', 'scale'), [
    { g: '大一', c: '4' },
    { g: '大一', c: '4' },
    { g: '大二', c: '4' },
    { g: '大二', c: '4' },
  ])!;
  assert.deepEqual(same.rows[0].diffs, [null]);
  assert.match(same.sentence, /无法比较均值差别/);
});

test('a numeric comparison can defer the median intervals and equals the synchronous result once they land', () => {
  const g = mk('g', 'single');
  const rows = [
    ...hours.slice(0, 150).map((v) => ({ g: '甲', c: String(v) })),
    ...hours.slice(150).map((v) => ({ g: '乙', c: String(v) })),
    { g: '丙', c: '' },
  ];
  const sync = compareQuestions(g, mk('c', 'numeric'), rows)!;
  const first = compareQuestions(g, mk('c', 'numeric'), rows, { deferBootstrap: true })!;
  assert.equal(first.medianPending, true);
  assert.equal(first.medianSamples?.length, 2);
  assert.deepEqual(
    first.rows[0].cells.map((cell) => cell.kind === 'mean' && cell.medianCI),
    [null, null],
  );
  const cis = first.medianSamples!.map((xs) => bootstrapIntervals(xs).median);
  assert.equal(withMedianIntervals(first, [cis[0], undefined]).medianPending, true);
  const done = withMedianIntervals(first, cis);
  assert.equal('medianPending' in done, false);
  assert.equal('medianSamples' in done, false);
  assert.deepEqual(done, sync);
  assert.equal(withMedianIntervals(done, cis), done);
  // 量表对比没有中位数区间，延后与否结果相同。
  const scale = compareQuestions(g, mk('c', 'scale'), rows, { deferBootstrap: true })!;
  assert.equal('medianSamples' in scale, false);
  assert.deepEqual(scale, compareQuestions(g, mk('c', 'scale'), rows));
});


test('Yates option changes a 2x2 comparison and is reported', () => {
  const table = [[183, 166], [25, 21]];
  const plain = independenceTest(table)!;
  const yates = independenceTest(table, { yates: true })!;
  assert.equal(plain.method, 'chisq');
  assert.equal(yates.yates, true);
  close(yates.statistic, 0.007584677753178, 1e-12);
  close(yates.p, 0.930599929976207, 1e-12);
  assert.match(formatTest(yates), /（Yates 校正）/);
  assert.doesNotMatch(formatTest(plain), /（Yates 校正）/);
});
