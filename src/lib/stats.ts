import type { Dataset, Question } from '../types.ts';
import { likertScore, numericValues, splitMultiDetailed } from './infer.ts';
import { bootstrapIntervals, meanInterval, wilsonInterval } from './intervals.ts';
import type { BootIntervals, Interval } from './intervals.ts';
import { ciDigits, formatCI, formatNumber, formatPct, formatPctCI, formatRange, isAnswer } from './text.ts';

export interface OptionRow {
  name: string;
  count: number;
  pct: number;
  ci: Interval | null;
  notes?: string[];
}

export interface Bin extends OptionRow {
  from: number;
  to: number;
}

interface Base {
  n: number;
  missing: number;
}

export type Stat =
  | (Base & { kind: 'single'; options: OptionRow[] })
  | (Base & { kind: 'multi'; options: OptionRow[]; avgSelected: number })
  | (Base & { kind: 'scale'; levels: OptionRow[]; numeric: boolean; mean: number | null; median: number | null; sd: number | null; top2: number | null; meanCI: Interval | null; top2CI: Interval | null })
  | (Base & { kind: 'numeric'; mean: number | null; median: number | null; sd: number | null; min: number | null; max: number | null; bins: Bin[]; meanCI: Interval | null; medianCI: Interval | null; ciPending?: boolean })
  | (Base & { kind: 'open'; avgChars: number; samples: string[] });

export function answersOf(q: Question, rows: Record<string, string>[]) {
  const all = rows.map((r) => r[q.id] ?? '');
  const valid = all.filter(isAnswer);
  return { valid, missing: all.length - valid.length };
}

function countBy(values: string[], key: (v: string) => string[] = (v) => [v]) {
  const counts = new Map<string, number>();
  for (const v of values) for (const k of key(v)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([name, count]) => ({ name, count }));
}

function byAppearance(values: string[]): OptionRow[] {
  const order = new Map<string, number>();
  for (const v of values) if (!order.has(v)) order.set(v, order.size);
  return toRows(countBy(values), values.length).sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
}

function toRows(entries: { name: string; count: number }[], n: number): OptionRow[] {
  return entries.map((e) => ({ ...e, pct: n === 0 ? 0 : e.count / n, ci: n === 0 ? null : wilsonInterval(e.count, n) }));
}

export function sampleNote(n: number) {
  if (n < 10) return '有效回答不足 10 条，区间很宽，仅供参考';
  if (n < 30) return '有效回答不足 30 条，区间较宽';
  return null;
}

export const withCI = (value: string, ci: { lower: number; upper: number } | null, digits: number) => (ci ? `${value}（95% 区间 ${formatCI(ci, digits)}）` : value);
export const withPctCI = (value: string, ci: Interval | null) => (ci ? `${value}（95% 区间 ${formatPctCI(ci)}）` : value);

export function mean(xs: number[]) {
  return xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function median(xs: number[]) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function sampleSD(xs: number[]) {
  const mu = mean(xs);
  if (mu === null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1));
}

// 步长取 1 / 2 / 2.5 / 5 × 10^n，保证分箱边界是读得出来的整数或有限小数。
function niceStep(raw: number) {
  const k = 10 ** Math.floor(Math.log10(raw));
  const m = raw / k;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * k;
}

function histogram(xs: number[]): Bin[] {
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  if (min === max) return [{ from: min - 0.5, to: max + 0.5, name: String(min), count: xs.length, pct: 1, ci: null }];
  const step = niceStep((max - min) / 10);
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  const f = (x: number) => x.toFixed(digits).replace(/\.0+$/, '');
  const start = Math.floor(min / step) * step;
  const bins: Bin[] = [];
  for (let i = 0; start + i * step < max - 1e-9; i++) {
    const lo = start + i * step;
    bins.push({ from: lo, to: lo + step, name: formatRange(lo, lo + step, f), count: 0, pct: 0, ci: null });
  }
  for (const x of xs) {
    bins[Math.min(bins.length - 1, Math.floor((x - start) / step + 1e-9))].count++;
  }
  return bins.map((b) => ({ ...b, pct: b.count / xs.length }));
}

// 这道数值题的有效取值；后台线程重抽样时用，与 computeStat 取同一批数。
export function numericSamples(q: Question, rows: Record<string, string>[]) {
  return numericValues(answersOf(q, rows).valid);
}

// 把后台算好的区间并回 computeStat(..., { deferBootstrap: true }) 先返回的结果。
export function withBootstrap(stat: Stat, boot: BootIntervals): Stat {
  if (stat.kind !== 'numeric' || !stat.ciPending) return stat;
  return {
    n: stat.n,
    missing: stat.missing,
    kind: 'numeric',
    mean: stat.mean,
    median: stat.median,
    sd: stat.sd,
    min: stat.min,
    max: stat.max,
    bins: stat.bins,
    meanCI: boot.mean,
    medianCI: boot.median,
  };
}

export function computeStat(q: Question, rows: Record<string, string>[], opts: { deferBootstrap?: boolean } = {}): Stat {
  const { valid, missing } = answersOf(q, rows);
  const base = { n: valid.length, missing };

  // 题型被手动改过时按新口径统计；量表/数值列里混入的非数字回答按文本档位处理。
  if (q.type === 'single') return { ...base, kind: 'single', options: toRows(countBy(valid), valid.length) };
  if (q.type === 'multi') {
    const counts = new Map<string, { count: number; notes: Set<string> }>();
    const perPerson: number[] = [];
    for (const v of valid) {
      const picks = splitMultiDetailed(v);
      perPerson.push(picks.length);
      for (const p of picks) {
        const entry = counts.get(p.name) ?? { count: 0, notes: new Set<string>() };
        entry.count++;
        if (p.note) entry.notes.add(p.note);
        counts.set(p.name, entry);
      }
    }
    const options = [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], 'zh'))
      .map(([name, e]) => ({
        name,
        count: e.count,
        pct: e.count / valid.length,
        ci: wilsonInterval(e.count, valid.length),
        ...(e.notes.size ? { notes: [...e.notes] } : {}),
      }));
    return { ...base, kind: 'multi', options, avgSelected: mean(perPerson) ?? 0 };
  }
  if (q.type === 'scale') {
    const nums = numericValues(valid);
    const numeric = nums.length === valid.length;
    if (!numeric) {
      const scores = valid.map((v) => likertScore(v));
      if (scores.every((s): s is number => s !== null)) {
        const xs = scores as number[];
        const labels = [...new Set(valid)].sort((a, b) => (likertScore(a) ?? 0) - (likertScore(b) ?? 0));
        const levels = labels.map((label) => {
          const count = valid.filter((v) => v === label).length;
          return { name: label, count, pct: count / valid.length, ci: wilsonInterval(count, valid.length) };
        });
        const distinct = [...new Set(xs)].sort((a, b) => a - b);
        const top2 = distinct.length < 2 ? null : xs.filter((x) => x >= distinct[distinct.length - 2]).length;
        return {
          ...base,
          kind: 'scale',
          levels,
          numeric: false,
          mean: mean(xs),
          median: median(xs),
          sd: sampleSD(xs),
          top2: top2 === null ? null : top2 / xs.length,
          meanCI: meanInterval(xs),
          top2CI: top2 === null ? null : wilsonInterval(top2, xs.length),
        };
      }
      return { ...base, kind: 'scale', levels: byAppearance(valid), numeric, mean: null, median: null, sd: null, top2: null, meanCI: null, top2CI: null };
    }
    const levels = toRows(countBy(valid), valid.length).sort((a, b) => Number(a.name) - Number(b.name));
    const distinct = [...new Set(nums)].sort((a, b) => a - b);
    const top2 = distinct.length < 2 ? null : nums.filter((x) => x >= distinct[distinct.length - 2]).length;
    return {
      ...base,
      kind: 'scale',
      levels,
      numeric: true,
      mean: mean(nums),
      median: median(nums),
      sd: sampleSD(nums),
      top2: top2 === null ? null : top2 / nums.length,
      meanCI: meanInterval(nums),
      top2CI: top2 === null ? null : wilsonInterval(top2, nums.length),
    };
  }
  if (q.type === 'numeric') {
    const nums = numericSamples(q, rows);
    if (nums.length === 0) return { ...base, kind: 'numeric', mean: null, median: null, sd: null, min: null, max: null, bins: [], meanCI: null, medianCI: null };
    const point = {
      ...base,
      kind: 'numeric' as const,
      mean: mean(nums),
      median: median(nums),
      sd: sampleSD(nums),
      min: Math.min(...nums),
      max: Math.max(...nums),
      bins: histogram(nums),
      meanCI: null,
      medianCI: null,
    };
    // 先出点估计和直方图，区间由后台线程算好后用 withBootstrap 补上。
    if (opts.deferBootstrap) return { ...point, ciPending: true };
    const boot = bootstrapIntervals(nums);
    return { ...point, meanCI: boot.mean, medianCI: boot.median };
  }
  const samples: string[] = [];
  const want = Math.min(6, valid.length);
  for (let i = 0; i < want; i++) samples.push(valid[Math.floor((i * valid.length) / want)]);
  return { ...base, kind: 'open', avgChars: mean(valid.map((v) => v.length)) ?? 0, samples };
}

export function buildFindings(rows: Record<string, string>[], questions: Question[], stats?: Record<string, Stat>): string[] {
  const candidates = new Map<Stat['kind'], { order: number; text: string }[]>();
  questions
    .filter((q) => q.included)
    .forEach((q, i) => {
      const s = stats?.[q.id] ?? computeStat(q, rows);
      if (s.n === 0) return;
      const note = sampleNote(s.n);
      const tail = note ? `${note}。` : '';
      if (s.kind === 'scale' && s.mean !== null) {
        candidates.set('scale', [...(candidates.get('scale') ?? []), { order: i, text: `「${q.title}」平均 ${withCI(`${formatNumber(s.mean, 2)} 分`, s.meanCI, 2)}${s.top2 !== null ? `，${withPctCI(`${formatPct(s.top2)} 的受访者给出了较高的两档评分`, s.top2CI)}` : ''}。${tail}` }]);
      } else if (s.kind === 'single' && s.options.length > 1 && s.options[0].pct < 0.95) {
        candidates.set('single', [...(candidates.get('single') ?? []), { order: i, text: `「${q.title}」中选择最多的是「${s.options[0].name}」，占 ${withPctCI(formatPct(s.options[0].pct), s.options[0].ci)}。${tail}` }]);
      } else if (s.kind === 'multi' && s.options.length > 0) {
        candidates.set('multi', [...(candidates.get('multi') ?? []), { order: i, text: `「${q.title}」里选择最多的是「${s.options[0].name}」（${withPctCI(formatPct(s.options[0].pct), s.options[0].ci)}），平均每人选 ${formatNumber(s.avgSelected)} 项。${tail}` }]);
      } else if (s.kind === 'numeric' && s.mean !== null) {
        candidates.set('numeric', [...(candidates.get('numeric') ?? []), { order: i, text: `「${q.title}」平均 ${withCI(formatNumber(s.mean, ciDigits(s.mean)), s.meanCI, ciDigits(s.mean))}，中位数 ${withCI(formatNumber(s.median, ciDigits(s.median)), s.medianCI, ciDigits(s.median))}。${tail}` }]);
      } else if (s.kind === 'open' && s.n >= 5) {
        candidates.set('open', [...(candidates.get('open') ?? []), { order: i, text: `「${q.title}」收到 ${s.n} 条开放回答，平均 ${formatNumber(s.avgChars, 0)} 字。` }]);
      }
    });

  const picked: { order: number; text: string }[] = [];
  for (let round = 0; picked.length < 6; round++) {
    const before = picked.length;
    for (const kind of ['scale', 'multi', 'single', 'numeric', 'open'] as const) {
      const next = candidates.get(kind)?.[round];
      if (next && picked.length < 6) picked.push(next);
    }
    if (picked.length === before) break;
  }
  return picked.sort((a, b) => a.order - b.order).map((c) => c.text);
}

export function validRowCount(dataset: Dataset) {
  const included = dataset.questions.filter((q) => q.included);
  return dataset.rows.filter((r) => included.some((q) => isAnswer(r[q.id]))).length;
}
