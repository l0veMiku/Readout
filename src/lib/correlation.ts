import type { CorrectionMethod, Question } from '../types.ts';
import type { Interval } from './intervals.ts';
import { tCDF } from './intervals.ts';
import { likertScore, numericValues } from './infer.ts';
import { formatCI } from './text.ts';
import { adjustP } from './adjust.ts';
import { spearmanPair } from './ranks.ts';
import { CORRECTION_LABELS } from './comparePro.ts';

// 相关分析的变量：题目标题就是矩阵里的名字。
export interface CorrVariable {
  question: Question;
}

export interface CorrPair {
  a: string;
  b: string;
  n: number;
  r: number | null;
  ci: Interval | null;
  p: number | null;
  // 算不出系数时的原因；算得出时为 null。
  blocker: string | null;
  // 专业模式：校正后的 p 与最终判定（是否加粗、是否算“明确”）。
  pAdjusted?: number | null;
  clear?: boolean;
}

export interface Correlation {
  variables: Question[];
  // 每个变量自己的有效取值数，矩阵对角线用。
  counts: number[];
  pairs: CorrPair[];
  sentence: string;
  // 专业模式：pearson（默认）或 spearman，以及校正方法与被校正的对数。
  method: 'pearson' | 'spearman';
  adjust?: { method: CorrectionMethod; m: number } | null;
}

export interface CorrOptions {
  adjust?: CorrectionMethod | null;
  rank?: boolean;
}

// 正态分布 97.5% 分位点，R 的 qnorm(0.975)；区间要跟 R 对得上，不能用 1.96。
const Z975 = 1.959963984540054;

export const isCorrQuestion = (q: Question | undefined) => !!q && q.included && (q.type === 'scale' || q.type === 'numeric');

// 量表题按文本档位或数字取分，数值题取数字；与信度、交叉分析用的是同一套取分。
export function corrValue(q: Question, raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  if (q.type === 'scale') return likertScore(raw) ?? numericValues([raw])[0] ?? null;
  return numericValues([raw])[0] ?? null;
}

export function corrValues(q: Question, rows: Record<string, string>[]): (number | null)[] {
  return rows.map((r) => corrValue(q, r[q.id]));
}

// 成对删除：只用两者都有作答的问卷。区间用 Fisher z，p 值用 t 分布，与 R cor.test 一致。
export function pearsonPair(xs: (number | null)[], ys: (number | null)[]): Omit<CorrPair, 'a' | 'b'> {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i];
    const b = ys[i];
    if (a === null || b === null) continue;
    x.push(a);
    y.push(b);
  }
  const n = x.length;
  if (n < 3) return { n, r: null, ci: null, p: null, blocker: `成对有效回答不足 3 条（${n} 条）` };
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
  if (sxx === 0) return { n, r: null, ci: null, p: null, blocker: '取值没有变化' };
  if (syy === 0) return { n, r: null, ci: null, p: null, blocker: '取值没有变化' };
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  // |r| = 1 时 Fisher z 发散，R 的区间退化为 1–1（或 −1 至 −1）；p 取 0。
  if (Math.abs(r) === 1) return { n, r, ci: { lower: r, upper: r }, p: 0, blocker: null };
  const z = 0.5 * Math.log((1 + r) / (1 - r));
  // R 的 cor.test 在 n = 3 时不给区间（1/√(n−3) 发散），这里同样只给 r 和 p。
  let ci: Interval | null = null;
  if (n > 3) {
    const half = Z975 / Math.sqrt(n - 3);
    ci = { lower: Math.tanh(z - half), upper: Math.tanh(z + half) };
  }
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const p = 2 * (1 - tCDF(Math.abs(t), n - 2));
  return { n, r, ci, p, blocker: null };
}

const excludesZero = (ci: Interval) => ci.lower > 0 || ci.upper < 0;

export function correlationFor(dataset: { questions: Question[] }, ids: string[], rows: Record<string, string>[], opts: CorrOptions = {}): Correlation | null {
  const variables = ids.flatMap((id) => {
    const q = dataset.questions.find((v) => v.id === id);
    return isCorrQuestion(q) ? [q as Question] : [];
  });
  if (variables.length < 2) return null;
  const values = variables.map((q) => corrValues(q, rows));
  const rank = !!opts.rank;
  const pairs: CorrPair[] = [];
  for (let i = 0; i < variables.length; i++) {
    for (let j = i + 1; j < variables.length; j++) {
      pairs.push({ a: variables[i].title, b: variables[j].title, ...(rank ? spearmanPair(values[i], values[j]) : pearsonPair(values[i], values[j])) });
    }
  }
  // 专业模式：校正只改判定（是否加粗、算不算“明确”），区间仍是未校正的。
  const adjust = opts.adjust ?? null;
  const adjusted = adjust ? adjustP(pairs.map((p) => p.p ?? Number.NaN), adjust) : null;
  const decided: CorrPair[] = pairs.map((p, i) => {
    const adj = adjusted ? adjusted[i] : null;
    const clear = p.r === null ? false : adj !== null ? !Number.isNaN(adj) && adj < 0.05 : p.ci !== null && excludesZero(p.ci);
    return { ...p, pAdjusted: adjust ? adj : null, clear };
  });
  const usable = decided.filter((p) => p.r !== null);
  const clear = decided.filter((p) => p.clear);
  const rawClear = usable.filter((p) => p.ci !== null && excludesZero(p.ci)).length;
  const strongest = usable.reduce<CorrPair | null>((best, p) => (best === null || Math.abs(p.r!) > Math.abs(best.r!) ? p : best), null);
  let sentence = `${variables.length} 个变量两两相关，共 ${pairs.length} 对；`;
  sentence += adjust
    ? `按 ${CORRECTION_LABELS[adjust]} 校正后 ${clear.length} 对 p < 0.05（未校正时 ${rawClear} 对的 95% 区间不含 0）。`
    : `${clear.length} 对的 95% 区间不含 0。`;
  if (strongest) {
    const interval = strongest.ci ? `，95% 区间 ${formatCI(strongest.ci, 2)}` : '，成对样本不足 4 份，没有区间';
    const adj = adjust && strongest.pAdjusted !== null && strongest.pAdjusted !== undefined
      ? `，校正后 ${strongest.pAdjusted < 0.001 ? 'p < 0.001' : `p = ${strongest.pAdjusted.toFixed(3)}`}`
      : '';
    sentence += `最强的一对是「${strongest.a}」和「${strongest.b}」（r = ${strongest.r!.toFixed(2)}${interval}，n = ${strongest.n}${adj}）。`;
  } else {
    sentence += '没有一对能算出系数。';
  }
  const m = pairs.filter((p) => p.p !== null).length;
  return {
    variables,
    counts: values.map((v) => v.filter((x) => x !== null).length),
    pairs: decided,
    sentence,
    method: rank ? 'spearman' : 'pearson',
    adjust: adjust ? { method: adjust, m } : null,
  };
}
