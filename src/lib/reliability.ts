import type { Question } from '../types.ts';
import { likertScore, numericValues } from './infer.ts';
import { isAnswer } from './text.ts';

export interface ReliabilityItem {
  id: string;
  citc: number | null;
  alphaIfDeleted: number | null;
}

export interface Reliability {
  // 参与计算的量表子题，顺序与传入的一致。
  items: ReliabilityItem[];
  // 在所有子题上都有作答、参与计算的份数。
  n: number;
  // 只答了题组里的一部分题、因而不参与的份数。
  partial: number;
  alpha: number | null;
  // 翻转范围：各题观测到的最小值与最大值的并集。
  range: { min: number; max: number } | null;
  // 不能给出 α 的原因；可以计算时为 null。
  note: string | null;
}

// 量表题的一个作答：数字直接用，文本档位按 1–5 计，其余算缺失。
export function scaleScore(raw: string | undefined): number | null {
  if (!isAnswer(raw)) return null;
  const text = (raw ?? '').trim();
  const n = numericValues([text])[0];
  if (n !== undefined) return n;
  return likertScore(text);
}

export function scaleRange(columns: (number | null)[][]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const col of columns) {
    for (const v of col) {
      if (v === null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return min === Infinity ? null : { min, max };
}

function variance(xs: number[]): number {
  const mu = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1);
}

// 各列是同一批问卷在 k 道题上的得分；方差为 0 或题数不足时没有定义。
export function cronbachAlpha(cols: number[][]): number | null {
  const k = cols.length;
  const n = cols[0]?.length ?? 0;
  if (k < 2 || n < 2) return null;
  const total = cols[0].map((_, i) => cols.reduce((s, c) => s + c[i], 0));
  const totalVar = variance(total);
  if (!(totalVar > 0)) return null;
  return (k / (k - 1)) * (1 - cols.reduce((s, c) => s + variance(c), 0) / totalVar);
}

function correlation(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 2) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (!(sxx > 0) || !(syy > 0)) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function sumOfOthers(cols: number[][], j: number): number[] {
  return cols[0].map((_, i) => cols.reduce((s, c, ci) => s + (ci === j ? 0 : c[i]), 0));
}

// 各题的取值范围要能对得上：单道题可能恰好没人选端点，所以允许每边超出公共部分一级。
export function scaleConsistent(columns: (number | null)[][]): boolean {
  const spans: { lo: number; hi: number }[] = [];
  for (const col of columns) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of col) {
      if (v === null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo !== Infinity) spans.push({ lo, hi });
  }
  if (spans.length < 2) return true;
  const lo = Math.max(...spans.map((s) => s.lo));
  const hi = Math.min(...spans.map((s) => s.hi));
  return spans.every((s) => lo - s.lo <= 1 + 1e-9 && s.hi - hi <= 1 + 1e-9);
}

// 题组的信度。只用传入题目里的量表类子题；不足两道时返回 null，界面不显示信度。
export function reliability(items: Question[], rows: Record<string, string>[]): Reliability | null {
  const scale = items.filter((q) => q.type === 'scale');
  if (scale.length < 2) return null;
  const columns = scale.map((q) => rows.map((r) => scaleScore(r[q.id])));
  const range = scaleRange(columns);
  // 反向题按题组的翻转范围折回去；没有范围时全部缺失，什么都算不了。
  const flipped = columns.map((col, j) => {
    const q = scale[j];
    return col.map((v) => (v === null || !range ? null : q.reversed ? range.min + range.max - v : v));
  });

  const complete: number[][] = [];
  let partial = 0;
  for (let ri = 0; ri < rows.length; ri++) {
    const line: number[] = [];
    for (const col of flipped) {
      const v = col[ri];
      if (v !== null) line.push(v);
    }
    if (line.length === scale.length) complete.push(line);
    else if (line.length > 0) partial++;
  }
  const cols = scale.map((_, j) => complete.map((line) => line[j]));
  const n = complete.length;

  let alpha: number | null = null;
  let note: string | null = null;
  if (!range) note = '这些题没有有效回答';
  else if (n < 2) note = '完整作答不足 2 份';
  else if (!scaleConsistent(columns)) note = '各题取值范围不一致，无法计算信度';
  else {
    alpha = cronbachAlpha(cols);
    if (alpha === null) note = '取值没有变化，无法计算信度';
  }

  return {
    items: scale.map((q, j) => ({
      id: q.id,
      citc: note === null ? correlation(cols[j], sumOfOthers(cols, j)) : null,
      alphaIfDeleted: alpha === null ? null : cronbachAlpha(cols.filter((_, ci) => ci !== j)),
    })),
    n,
    partial,
    alpha,
    range,
    note,
  };
}
