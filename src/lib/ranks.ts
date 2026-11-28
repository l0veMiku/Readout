import { chisqCDF, tCDF } from './intervals.ts';
import type { Interval } from './intervals.ts';

// 正态分布 97.5% 分位点（R 的 qnorm(0.975)）。
const Z975 = 1.959963984540054;

// 标准正态尾概率 P(|Z| ≥ z) = erfc(z / √2)。erfc 用两条分支保证到 1e-15：
// x < 1 用泰勒级数（逐项到 1e-18），x ≥ 1 用连分式（Lentz）。
function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x < 1) {
    let sum = 0;
    let power = x;
    let fact = 1;
    for (let n = 0; n < 120; n++) {
      if (n > 0) {
        power *= x * x;
        fact *= n;
      }
      const term = power / (fact * (2 * n + 1));
      sum += n % 2 === 0 ? term : -term;
      if (term < 1e-18) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  let f = x;
  let c = x;
  let d = 0;
  for (let i = 1; i <= 300; i++) {
    const a = i / 2;
    d = x + a * d;
    if (d === 0) d = 1e-300;
    d = 1 / d;
    c = x + a / c;
    if (c === 0) c = 1e-300;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * f);
}

const twoSidedP = (z: number) => erfc(Math.abs(z) / Math.SQRT2);

// 平均秩：并列取值分同一个秩。
export function averageRanks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length).fill(0);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k].i] = rank;
    i = j + 1;
  }
  return ranks;
}

export interface SpearmanResult {
  n: number;
  r: number | null;
  ci: Interval | null;
  p: number | null;
  blocker: string | null;
}

interface NumPair {
  r: number | null;
  ci: Interval | null;
  p: number | null;
  blocker: string | null;
}

// 皮尔逊相关的核心：给一对数值，算 r、Fisher z 区间与 t 近似 p。
function correlationOf(x: number[], y: number[]): NumPair {
  const n = x.length;
  if (n < 3) return { r: null, ci: null, p: null, blocker: `成对有效回答不足 3 条（${n} 条）` };
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx === 0 || syy === 0) return { r: null, ci: null, p: null, blocker: '取值没有变化' };
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  if (Math.abs(r) === 1) return { r, ci: { lower: r, upper: r }, p: 0, blocker: null };
  let ci: Interval | null = null;
  if (n > 3) {
    const z = 0.5 * Math.log((1 + r) / (1 - r));
    const half = Z975 / Math.sqrt(n - 3);
    ci = { lower: Math.tanh(z - half), upper: Math.tanh(z + half) };
  }
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return { r, ci, p: 2 * (1 - tCDF(Math.abs(t), n - 2)), blocker: null };
}


// Spearman：对取值取平均秩后做相关。ties 多时 p 与区间都是近似（与 R 的 exact = FALSE 一致）。
export function spearmanPair(xs: (number | null)[], ys: (number | null)[]): SpearmanResult {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i];
    const b = ys[i];
    if (a === null || b === null) continue;
    x.push(a);
    y.push(b);
  }
  const result = correlationOf(averageRanks(x), averageRanks(y));
  return { n: x.length, ...result };
}

export interface MannWhitneyResult {
  u: number;
  z: number;
  p: number;
  r: number;
}

// 两组 Mann–Whitney U：ties 校正 + 连续性校正的正态近似，与 R wilcox.test(exact = FALSE, correct = TRUE) 一致。
export function mannWhitneyU(x: number[], y: number[]): MannWhitneyResult | null {
  const n1 = x.length;
  const n2 = y.length;
  if (n1 === 0 || n2 === 0) return null;
  const all = [...x, ...y];
  const ranks = averageRanks(all);
  let sum = 0;
  for (let i = 0; i < n1; i++) sum += ranks[i];
  const u = sum - (n1 * (n1 + 1)) / 2;
  const n = n1 + n2;
  const counts = new Map<number, number>();
  for (const v of all) counts.set(v, (counts.get(v) ?? 0) + 1);
  let tie = 0;
  for (const t of counts.values()) tie += t ** 3 - t;
  const variance = ((n1 * n2) / 12) * (n + 1 - tie / (n * (n - 1)));
  if (!(variance > 0)) return null;
  const diff = u - (n1 * n2) / 2;
  const z = (diff - Math.sign(diff) * 0.5) / Math.sqrt(variance);
  return { u, z, p: twoSidedP(z), r: Math.abs(z) / Math.sqrt(n) };
}

export interface KruskalResult {
  h: number;
  df: number;
  p: number;
  epsilon2: number;
}

// Kruskal–Wallis：ties 校正的 χ² 近似，与 R kruskal.test 一致；效应量 ε² = (H − k + 1) / (n − k)。
export function kruskalWallis(groups: number[][]): KruskalResult | null {
  const live = groups.filter((g) => g.length > 0);
  const k = live.length;
  if (k < 2) return null;
  const all = live.flat();
  const n = all.length;
  const ranks = averageRanks(all);
  let offset = 0;
  let h = 0;
  for (const g of live) {
    const sum = ranks.slice(offset, offset + g.length).reduce((s, v) => s + v, 0);
    h += (sum * sum) / g.length;
    offset += g.length;
  }
  h = (12 / (n * (n + 1))) * h - 3 * (n + 1);
  const counts = new Map<number, number>();
  for (const v of all) counts.set(v, (counts.get(v) ?? 0) + 1);
  let tie = 0;
  for (const t of counts.values()) tie += t ** 3 - t;
  const correction = 1 - tie / (n ** 3 - n);
  if (!(correction > 0)) return null;
  h /= correction;
  const df = k - 1;
  const p = 1 - chisqCDF(h, df);
  // ε² 在秩检验里可能算出负数（没有效应时），报表里截断为 0。
  const epsilon2 = n > k ? Math.max(0, (h - k + 1) / (n - k)) : 0;
  return { h, df, p, epsilon2 };
}
