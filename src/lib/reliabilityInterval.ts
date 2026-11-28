import { bootstrapReps } from './intervals.ts';
import type { Interval } from './intervals.ts';
import { cronbachAlpha } from './reliability.ts';

// 固定种子，保证同一份数据每次得到相同的区间（与数值题的 Bootstrap 同一约定）。
const SEED = 20260401;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 按「回答者 × 题目」的行向量算 Cronbach's α，与 reliability.ts 的列口径一致。
function alphaOfRows(rows: number[][]): number | null {
  const n = rows.length;
  const k = rows[0]?.length ?? 0;
  if (n < 2 || k < 2) return null;
  const itemVar = Array.from({ length: k }, (_, j) => {
    let mean = 0;
    for (const row of rows) mean += row[j];
    mean /= n;
    let ss = 0;
    for (const row of rows) ss += (row[j] - mean) ** 2;
    return ss / (n - 1);
  });
  const totals = rows.map((row) => row.reduce((s, x) => s + x, 0));
  let mean = 0;
  for (const t of totals) mean += t;
  mean /= n;
  let totalVar = 0;
  for (const t of totals) totalVar += (t - mean) ** 2;
  totalVar /= n - 1;
  if (!(totalVar > 0)) return null;
  return (k / (k - 1)) * (1 - itemVar.reduce((s, x) => s + x, 0) / totalVar);
}

// type-7 分位数，与 intervals.ts 的口径一致。
function quantile(sorted: number[], p: number) {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

// α 的 95% Bootstrap 区间（百分位法）；完整作答不足 5 份或 α 算不出来时返回 null。
export function alphaInterval(cols: number[][]): Interval | null {
  const k = cols.length;
  if (k < 2) return null;
  const n = cols[0]?.length ?? 0;
  if (n < 5) return null;
  if (cronbachAlpha(cols) === null) return null;
  const rows = Array.from({ length: n }, (_, i) => cols.map((c) => c[i]));
  const random = mulberry32(SEED);
  const reps = bootstrapReps(n);
  const alphas: number[] = [];
  for (let b = 0; b < reps; b++) {
    const sample: number[][] = [];
    for (let i = 0; i < n; i++) sample.push(rows[Math.floor(random() * n)]);
    const alpha = alphaOfRows(sample);
    if (alpha !== null) alphas.push(alpha);
  }
  if (alphas.length < 20) return null;
  alphas.sort((a, b) => a - b);
  return { lower: quantile(alphas, 0.025), upper: quantile(alphas, 0.975) };
}
