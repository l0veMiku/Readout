import type { Question } from '../types.ts';
import { bootstrapIntervals, chisqCDF, logGamma, meanInterval, tCDF, tQuantile, wilsonInterval } from './intervals.ts';
import type { Interval } from './intervals.ts';
import { likertScore, numericValues, splitMulti } from './infer.ts';
import { mean, median, sampleSD } from './stats.ts';
import { formatNumber, formatP, formatRange, isAnswer } from './text.ts';

const COMPARE_TYPES = new Set(['single', 'multi', 'scale', 'numeric']);
const FISHER_MAX_TABLES = 2_000_000;

export function canCompare(group: Question | null, compare: Question | null): boolean {
  return (
    !!group &&
    !!compare &&
    group.type === 'single' &&
    group.id !== compare.id &&
    group.included &&
    compare.included &&
    COMPARE_TYPES.has(compare.type)
  );
}

export function newcombeInterval(a: number, n1: number, b: number, n2: number): Interval | null {
  if (n1 === 0 || n2 === 0) return null;
  const l1 = wilsonInterval(a, n1);
  const l2 = wilsonInterval(b, n2);
  const p1 = a / n1;
  const p2 = b / n2;
  const d = p1 - p2;
  return {
    lower: d - Math.hypot(p1 - l1.lower, l2.upper - p2),
    upper: d + Math.hypot(l1.upper - p1, p2 - l2.lower),
  };
}

export interface WelchResult extends Interval {
  diff: number;
  t: number;
  df: number;
  p: number;
  d: number | null;
}

export function welchDiff(x: number[], y: number[]): WelchResult | null {
  const sx = sampleSD(x);
  const sy = sampleSD(y);
  const mx = mean(x);
  const my = mean(y);
  if (x.length < 2 || y.length < 2 || !sx || !sy || mx === null || my === null) return null;
  const vx = sx ** 2;
  const vy = sy ** 2;
  const qx = vx / x.length;
  const qy = vy / y.length;
  const se = Math.sqrt(qx + qy);
  const df = se ** 4 / (qx ** 2 / (x.length - 1) + qy ** 2 / (y.length - 1));
  const diff = mx - my;
  const t = diff / se;
  const half = tQuantile(0.975, df) * se;
  return {
    diff,
    lower: diff - half,
    upper: diff + half,
    t,
    df,
    p: Math.max(0, 2 * (1 - tCDF(Math.abs(t), df))),
    d: diff / Math.sqrt(((x.length - 1) * vx + (y.length - 1) * vy) / (x.length + y.length - 2)),
  };
}

export interface ChisqResult {
  statistic: number;
  df: number;
  p: number;
  minExpected: number;
  lowCells: number;
}

export function chisqTest(table: number[][]): ChisqResult | null {
  const cols = table[0]?.length ?? 0;
  const rowTotals = table.map((r) => r.reduce((s, x) => s + x, 0));
  const colTotals = Array.from({ length: cols }, (_, j) => table.reduce((s, r) => s + r[j], 0));
  const liveCols = colTotals.filter((c) => c > 0).length;
  const total = rowTotals.reduce((s, x) => s + x, 0);
  if (table.length < 2 || liveCols < 2 || total === 0) return null;
  let statistic = 0;
  let minExpected = Infinity;
  let low = 0;
  let cells = 0;
  table.forEach((row, i) =>
    row.forEach((o, j) => {
      if (colTotals[j] === 0) return;
      const e = (rowTotals[i] * colTotals[j]) / total;
      statistic += ((o - e) ** 2) / e;
      minExpected = Math.min(minExpected, e);
      cells++;
      if (e < 5) low++;
    }),
  );
  const df = (table.length - 1) * (liveCols - 1);
  return { statistic, df, p: Math.max(0, 1 - chisqCDF(statistic, df)), minExpected, lowCells: low / cells };
}

// 两组表的 Fisher 精确检验：枚举固定边际下的全部表，累加概率不高于观测表的那些（与 R fisher.test 同一口径）。
export function fisherTwoRows(first: number[], colTotals: number[]): number | null {
  const n1 = first.reduce((s, x) => s + x, 0);
  const total = colTotals.reduce((s, x) => s + x, 0);
  const n2 = total - n1;
  const lf = Array.from({ length: total + 1 }, (_, i) => logGamma(i + 1));
  const base = colTotals.reduce((s, c) => s + lf[c], 0) + lf[n1] + lf[n2] - lf[total];
  const observedLP = base - first.reduce((s, a, j) => s + lf[a] + lf[colTotals[j] - a], 0);
  const suffix: number[] = [];
  for (let j = colTotals.length - 1; j >= 0; j--) suffix[j] = (suffix[j + 1] ?? 0) + colTotals[j];
  let sum = 0;
  let seen = 0;
  const walk = (j: number, remaining: number, acc: number): boolean => {
    if (j === colTotals.length) {
      if (++seen > FISHER_MAX_TABLES) return false;
      const ratio = Math.exp(base - acc - observedLP);
      if (ratio <= 1 || Math.abs(ratio - 1) <= 1e-7) sum += ratio;
      return true;
    }
    for (let a = Math.max(0, remaining - (suffix[j + 1] ?? 0)); a <= Math.min(colTotals[j], remaining); a++) {
      if (!walk(j + 1, remaining - a, acc + lf[a] + lf[colTotals[j] - a])) return false;
    }
    return true;
  };
  return walk(0, n1, 0) ? sum * Math.exp(observedLP) : null;
}

export interface TestResult extends ChisqResult {
  method: 'chisq' | 'fisher';
  unreliable: boolean;
}

export function independenceTest(table: number[][]): TestResult | null {
  const cs = chisqTest(table);
  if (!cs) return null;
  let method: 'chisq' | 'fisher' = 'chisq';
  let p = cs.p;
  let unreliable = cs.lowCells > 0.2;
  if (table.length === 2 && cs.minExpected < 5) {
    const colTotals = Array.from({ length: table[0].length }, (_, j) => table[0][j] + table[1][j]);
    const exact = fisherTwoRows(table[0], colTotals);
    if (exact !== null) {
      method = 'fisher';
      p = exact;
      unreliable = false;
    } else {
      unreliable = true;
    }
  }
  return { ...cs, method, p, unreliable };
}

export function formatTest(test: TestResult): string {
  const p = `p = ${formatP(test.p)}`;
  const base = test.method === 'fisher' ? `Fisher 精确检验，${p}` : `卡方 = ${formatNumber(test.statistic, 2)}，df = ${test.df}，${p}`;
  return `${base}${test.unreliable ? '（部分类别人数过少，检验结果仅供参考）' : ''}`;
}

export interface CompareGroup {
  name: string;
  n: number;
}

export interface PropCell {
  kind: 'prop';
  count: number;
  pct: number;
  ci: Interval | null;
}

export interface MeanCell {
  kind: 'mean';
  n: number;
  mean: number | null;
  meanCI: Interval | null;
  median: number | null;
  medianCI: Interval | null;
}

export interface Diff {
  diff: number;
  lower: number;
  upper: number;
  p: number | null;
  d: number | null;
}

export interface CompareRow {
  name: string;
  cells: (PropCell | MeanCell)[];
  diffs: (Diff | null)[];
  test: TestResult | null;
  sentence: string;
}

export interface Comparison {
  group: string;
  compare: string;
  groupTitle: string;
  compareTitle: string;
  mode: 'prop' | 'mean';
  multi: boolean;
  n: number;
  groups: CompareGroup[];
  rows: CompareRow[];
  test: TestResult | null;
  sentence: string;
  // 只在 deferBootstrap 且对比题是数值题时存在：各组待重抽样的取值，以及「区间还没到」的标记。
  medianSamples?: number[][];
  medianPending?: boolean;
}

type Amount = (x: number) => string;

const excludesZero = (ci: Interval) => ci.lower > 0 || ci.upper < 0;

function diffPhrase(name: string, d: Diff, unit: string, amount: Amount) {
  const size = `${d.diff > 0 ? '高' : '低'} ${amount(Math.abs(d.diff))}${unit}`;
  const ci = `95% 区间 ${formatRange(d.lower, d.upper, amount)}`;
  return excludesZero(d) ? `${name} ${size}（${ci}）` : `${name} 没有看到明确差别（${size}，${ci}）`;
}

function phrases(groups: CompareGroup[], diffs: (Diff | null)[], unit: string, amount: Amount) {
  return diffs.map((d, i) => (d ? diffPhrase(groups[i + 1].name, d, unit, amount) : null)).filter((p): p is string => p !== null);
}

const pctPoints: Amount = (x) => formatNumber(x * 100, 1);

// 把后台算好的各组中位数区间并回 compareQuestions(..., { deferBootstrap: true }) 的结果。
// intervals 里尚未到达的组用 undefined 表示；全部到齐后返回的对象与同步计算的结果完全相同。
export function withMedianIntervals(comparison: Comparison, intervals: (Interval | null | undefined)[]): Comparison {
  if (!comparison.medianPending) return comparison;
  const merged: Comparison = {
    ...comparison,
    rows: comparison.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell, gi) => (cell.kind === 'mean' ? { ...cell, medianCI: intervals[gi] ?? null } : cell)),
    })),
  };
  if (intervals.some((ci) => ci === undefined)) return merged;
  delete merged.medianPending;
  delete merged.medianSamples;
  return merged;
}

export function compareQuestions(group: Question, compare: Question, rows: Record<string, string>[], opts: { deferBootstrap?: boolean } = {}): Comparison | null {
  if (!canCompare(group, compare)) return null;
  const picked = rows.filter((r) => isAnswer(r[group.id]) && isAnswer(r[compare.id]));
  const counts = new Map<string, number>();
  for (const r of picked) {
    const g = (r[group.id] ?? '').trim();
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const groups: CompareGroup[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([name, n]) => ({ name, n }));
  const base = {
    group: group.id,
    compare: compare.id,
    groupTitle: group.title,
    compareTitle: compare.title,
    multi: compare.type === 'multi',
    n: picked.length,
    groups,
    test: null,
  };
  const oneGroup = '分组题只有一组有有效回答，无法比较差别。';
  if (picked.length === 0) return { ...base, mode: 'mean', rows: [], sentence: '没有同时有效回答这两道题的记录。' };

  if (compare.type === 'scale' || compare.type === 'numeric') {
    const read = (raw: string) => {
      const n = numericValues([raw])[0];
      if (n !== undefined) return n;
      return compare.type === 'scale' ? likertScore(raw.trim()) : null;
    };
    const perGroup = groups.map((g) =>
      picked
        .filter((r) => (r[group.id] ?? '').trim() === g.name)
        .map((r) => read(r[compare.id] ?? ''))
        .filter((v): v is number => v !== null),
    );
    const numeric = compare.type === 'numeric';
    const cells: MeanCell[] = perGroup.map((xs) => ({
      kind: 'mean',
      n: xs.length,
      mean: mean(xs),
      meanCI: meanInterval(xs),
      median: numeric ? median(xs) : null,
      medianCI: numeric && !opts.deferBootstrap ? bootstrapIntervals(xs).median : null,
    }));
    const diffs = perGroup.slice(1).map((xs) => welchDiff(xs, perGroup[0]));
    const amount: Amount = (x) => formatNumber(x, 2);
    const unit = numeric ? '' : ' 分';
    const parts = phrases(groups, diffs, unit, amount);
    const head = `各组在「${compare.title}」上的均值${diffs.some((d) => d && excludesZero(d)) ? '存在差别' : '没有看到明确差别'}（相对基准组「${groups[0].name}」）：`;
    const sentence = groups.length < 2 ? oneGroup : parts.length ? `${head}${parts.join('；')}。` : '各组的有效回答不足 2 条或取值完全相同，无法比较均值差别。';
    return {
      ...base,
      mode: 'mean',
      rows: [{ name: '均值', cells, diffs, test: null, sentence: parts.length ? `${parts.join('；')}。` : '无法比较各组均值。' }],
      sentence,
      ...(numeric && opts.deferBootstrap ? { medianSamples: perGroup, medianPending: true } : {}),
    };
  }

  const grid = new Map<string, number[]>();
  for (const r of picked) {
    const gi = groups.findIndex((g) => g.name === (r[group.id] ?? '').trim());
    const options = compare.type === 'multi' ? splitMulti(r[compare.id] ?? '') : [(r[compare.id] ?? '').trim()];
    for (const opt of options) {
      const line = grid.get(opt) ?? groups.map(() => 0);
      line[gi]++;
      grid.set(opt, line);
    }
  }
  const options = [...grid.entries()].sort((a, b) => b[1].reduce((s, x) => s + x, 0) - a[1].reduce((s, x) => s + x, 0) || a[0].localeCompare(b[0], 'zh'));
  const single = compare.type === 'single';
  const rowsOut: CompareRow[] = options.map(([name, line]) => {
    const cells: PropCell[] = line.map((count, gi) => ({
      kind: 'prop',
      count,
      pct: count / groups[gi].n,
      ci: wilsonInterval(count, groups[gi].n),
    }));
    const diffs = line.slice(1).map((count, gi) => {
      const ci = newcombeInterval(count, groups[gi + 1].n, line[0], groups[0].n);
      return ci ? { diff: count / groups[gi + 1].n - line[0] / groups[0].n, lower: ci.lower, upper: ci.upper, p: null, d: null } : null;
    });
    const test = !single && groups.length >= 2 ? independenceTest(groups.map((_, gi) => [line[gi], groups[gi].n - line[gi]])) : null;
    const parts = phrases(groups, diffs, ' 个百分点', pctPoints);
    return { name, cells, diffs, test, sentence: parts.length ? `「${name}」：${parts.join('；')}。` : `「${name}」：无法比较各组占比。` };
  });
  const test = single && groups.length >= 2 ? independenceTest(groups.map((_, gi) => options.map(([, line]) => line[gi]))) : null;
  const flat = rowsOut.flatMap((r) => r.diffs);
  const found = flat.filter((d): d is Diff => d !== null && excludesZero(d));
  const rest = flat.length - found.length;
  const comparable = flat.some((d) => d !== null);
  let sentence: string;
  if (groups.length < 2) sentence = oneGroup;
  else if (!comparable) sentence = '各组的有效回答不足，无法比较占比差别。';
  else if (found.length === 0) sentence = `相对基准组「${groups[0].name}」，各选项的占比都没有看到明确差别（所有区间都包含 0）。`;
  else {
    const biggest = found.reduce((a, b) => (Math.abs(b.diff) > Math.abs(a.diff) ? b : a));
    let where = '';
    for (const row of rowsOut) {
      const gi = row.diffs.indexOf(biggest);
      if (gi >= 0) where = `「${row.name}」的占比：${diffPhrase(groups[gi + 1].name, biggest, ' 个百分点', pctPoints)}`;
    }
    sentence = `相对基准组「${groups[0].name}」，差别最大的一处是${where}；${found.length} 处区间不含 0，${rest} 处没有看到明确差别。`;
  }
  if (test) sentence += `整体分布检验：${formatTest(test)}。`;
  if (compare.type === 'multi') sentence += '各选项分别检验，未做多重比较校正。';
  return { ...base, mode: 'prop', rows: rowsOut, test, sentence };
}
