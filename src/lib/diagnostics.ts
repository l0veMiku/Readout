import type { Dataset } from '../types.ts';
import type { CardItem } from './groups.ts';
import type { Interval } from './intervals.ts';
import type { Reliability } from './reliability.ts';
import type { ReliabilityExtras } from './reliabilityExtras.ts';
import type { Stat } from './stats.ts';

export type IssueLevel = 'alert' | 'warn' | 'info';

export interface DiagnosticIssue {
  level: IssueLevel;
  title: string;
  detail: string;
  cardIndex: number | null;
}

export interface MissingRow {
  id: string;
  name: string;
  n: number;
  missing: number;
  rate: number;
  cardIndex: number;
}

export interface ShapeRow {
  id: string;
  name: string;
  n: number;
  skew: number;
  skewSE: number;
  kurtosis: number;
  kurtosisSE: number;
  cardIndex: number;
}

export interface GroupRow {
  id: string;
  title: string;
  cardIndex: number;
  questions: { id: string; name: string; reversed: boolean; citc: number | null }[];
  alpha: number | null;
  alphaCI: Interval | null;
  complete: number | null;
  kmo: number | null;
  bartlett: { chi2: number; df: number; p: number } | null;
  omega: number | null;
  notes: string[];
}

export interface Diagnostics {
  missing: MissingRow[];
  shapes: ShapeRow[];
  groups: GroupRow[];
  issues: DiagnosticIssue[];
}

export const LEVEL_LABELS: Record<IssueLevel, string> = { alert: '需要处理', warn: '注意', info: '提示' };

// KMO 的常用参考档位；只给文字，不替用户下“通过/不通过”的结论。
export function kmoBand(kmo: number) {
  if (kmo >= 0.8) return '好';
  if (kmo >= 0.7) return '中';
  if (kmo >= 0.6) return '勉强';
  return '不适合';
}

// 五个数：最小值、Q1、中位数、Q3、最大值（type-7 分位，与 intervals.ts 一致）。
export function fiveNumbers(xs: number[]) {
  if (xs.length < 5) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const q = (p: number) => {
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.min(lo + 1, sorted.length - 1);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
  };
  return { min: sorted[0], q1: q(0.25), median: q(0.5), q3: q(0.75), max: sorted[sorted.length - 1] };
}

const LEVEL_ORDER: Record<IssueLevel, number> = { alert: 0, warn: 1, info: 2 };

// 体检数据：缺失、分布、题组信度与因子前置检验，加上一份可操作的“问题清单”。
export function buildDiagnostics(input: {
  dataset: Dataset;
  items: CardItem[];
  stats: Record<string, Stat>;
  reliabilities: Record<string, Reliability | null>;
  extras: Record<string, ReliabilityExtras | null>;
}): Diagnostics {
  const { items, stats, reliabilities, extras } = input;
  const cardIndexOf = new Map<string, number>();
  items.forEach((item, i) => {
    if (item.kind === 'group') {
      cardIndexOf.set(`group:${item.group.id}`, i);
      item.questions.forEach((q) => cardIndexOf.set(q.id, i));
    } else {
      cardIndexOf.set(item.question.id, i);
    }
  });

  const questions = items.flatMap((item) => (item.kind === 'question' ? [item.question] : item.questions));
  const missing: MissingRow[] = questions.flatMap((q) => {
    const stat = stats[q.id];
    if (!stat || q.derived) return [];
    const total = stat.n + stat.missing;
    return [{ id: q.id, name: q.subTitle ?? q.title, n: stat.n, missing: stat.missing, rate: total > 0 ? stat.missing / total : 0, cardIndex: cardIndexOf.get(q.id) ?? 0 }];
  });

  const shapes: ShapeRow[] = questions.flatMap((q) => {
    const stat = stats[q.id];
    if (!stat || (stat.kind !== 'scale' && stat.kind !== 'numeric') || !stat.shape) return [];
    return [{ id: q.id, name: q.subTitle ?? q.title, n: stat.shape.n, skew: stat.shape.skew, skewSE: stat.shape.skewSE, kurtosis: stat.shape.kurtosis, kurtosisSE: stat.shape.kurtosisSE, cardIndex: cardIndexOf.get(q.id) ?? 0 }];
  });

  const groups: GroupRow[] = items.flatMap((item) => {
    if (item.kind !== 'group') return [];
    const rel = reliabilities[item.group.id] ?? null;
    const ext = extras[item.group.id] ?? null;
    const citcOf = new Map(rel?.items.map((it) => [it.id, it.citc]) ?? []);
    return [
      {
        id: item.group.id,
        title: item.group.title,
        cardIndex: cardIndexOf.get(`group:${item.group.id}`) ?? 0,
        questions: item.questions.map((q) => ({ id: q.id, name: q.subTitle ?? q.title, reversed: !!q.reversed, citc: citcOf.get(q.id) ?? null })),
        alpha: rel?.alpha ?? null,
        alphaCI: ext?.alphaCI ?? null,
        complete: rel?.n ?? null,
        kmo: ext?.kmo ?? null,
        bartlett: ext?.bartlett ?? null,
        omega: ext?.omega ?? null,
        notes: ext?.notes ?? [],
      },
    ];
  });

  const issues: DiagnosticIssue[] = [];
  for (const g of groups) {
    if (g.alpha !== null && g.alpha < 0.7) {
      issues.push({ level: g.alpha < 0.5 ? 'alert' : 'warn', title: `题组「${g.title}」α = ${g.alpha.toFixed(3)}`, detail: '常见参考 0.70；α 低通常意味着题目不属于同一维度，或反向题没有标记。', cardIndex: g.cardIndex });
    }
    for (const q of g.questions) {
      if (!q.reversed && q.citc !== null && q.citc < -0.2) {
        issues.push({ level: 'alert', title: `「${q.name}」可能是反向题`, detail: `它与题组其余题之和负相关（r = ${q.citc.toFixed(2)}），建议在卡片里标为反向后重算信度。`, cardIndex: g.cardIndex });
      }
    }
    if (g.kmo !== null) {
      if (g.kmo < 0.5) issues.push({ level: 'alert', title: `题组「${g.title}」KMO = ${g.kmo.toFixed(3)}`, detail: '低于 0.50，通常不适合做因子分析；先检查题目是否属于同一维度。', cardIndex: g.cardIndex });
      else if (g.kmo < 0.6) issues.push({ level: 'warn', title: `题组「${g.title}」KMO = ${g.kmo.toFixed(3)}`, detail: '0.50–0.60 属“勉强”，因子分析的结论要谨慎。', cardIndex: g.cardIndex });
    }
    for (const note of g.notes) {
      issues.push({ level: 'info', title: `题组「${g.title}」`, detail: note, cardIndex: g.cardIndex });
    }
  }
  for (const m of missing) {
    if (m.rate > 0.2) issues.push({ level: 'alert', title: `「${m.name}」缺失 ${m.missing} 份（${(m.rate * 100).toFixed(1)}%）`, detail: '缺失超过 20%，做占比或均值前先确认是不是跳题逻辑；必要时在清洗里处理。', cardIndex: m.cardIndex });
    else if (m.rate > 0.1) issues.push({ level: 'warn', title: `「${m.name}」缺失 ${m.missing} 份（${(m.rate * 100).toFixed(1)}%）`, detail: '缺失超过 10%，解释结果时提一句更稳妥。', cardIndex: m.cardIndex });
  }
  for (const s of shapes) {
    if (Math.abs(s.skew) > 1) issues.push({ level: 'warn', title: `「${s.name}」偏度 ${s.skew.toFixed(2)}`, detail: '偏度绝对值超过 1，明显偏态；均值差与 t 区间要谨慎，可考虑秩检验。', cardIndex: s.cardIndex });
    else if (Math.abs(s.kurtosis) > 2) issues.push({ level: 'warn', title: `「${s.name}」峰度 ${s.kurtosis.toFixed(2)}`, detail: '峰度绝对值超过 2，尾部较重；区间与显著性判断要保守。', cardIndex: s.cardIndex });
  }
  // 组内题目取值范围不一致（原卡片已有 blocker 文案，这里只作为提示列出）。
  for (const item of items) {
    if (item.kind !== 'group') continue;
    const ext = extras[item.group.id] ?? null;
    if (ext && ext.kmo === null && ext.notes.length > 0 && !issues.some((i) => i.cardIndex === cardIndexOf.get(`group:${item.group.id}`) && i.level === 'info')) {
      issues.push({ level: 'info', title: `题组「${item.group.title}」`, detail: ext.notes[0], cardIndex: cardIndexOf.get(`group:${item.group.id}`) ?? 0 });
    }
  }

  issues.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (a.cardIndex ?? 0) - (b.cardIndex ?? 0));
  return { missing, shapes, groups, issues };
}
