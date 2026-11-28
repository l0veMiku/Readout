import type { Cleaning, CleaningRule, Dataset, Question, RuleMode, RuleType } from '../types.ts';
import { splitMulti } from './infer.ts';
import { scaleRange, scaleScore } from './reliability.ts';
import { median } from './stats.ts';
import { isAnswer } from './text.ts';

export type RowStatus = 'valid' | 'flagged' | 'excluded';

export const RULE_TYPES: RuleType[] = ['duration', 'straightline', 'screening', 'completion', 'contradiction'];

export const RULE_LABELS: Record<RuleType, string> = {
  duration: '作答时长',
  straightline: '规律作答',
  screening: '甄别题',
  completion: '完成率',
  contradiction: '正反向题矛盾',
};

// 规则添加后预选的处理方式。只有甄别题是问卷设计时就定下的，其余四条都是启发式的。
export const DEFAULT_MODE: Record<RuleType, RuleMode> = {
  duration: 'flag',
  straightline: 'flag',
  screening: 'exclude',
  completion: 'flag',
  contradiction: 'flag',
};

let ruleSeq = 0;

// 新规则还没有参数，参数填好之前不生效。
export function newRule(type: RuleType): CleaningRule {
  const id = `r${Date.now().toString(36)}${(ruleSeq++).toString(36)}`;
  const mode = DEFAULT_MODE[type];
  switch (type) {
    case 'duration':
      return { id, type, maxSeconds: 0, mode };
    case 'straightline':
      return { id, type, groupId: '', mode };
    case 'screening':
      return { id, type, questionId: '', option: '', mode };
    case 'completion':
      return { id, type, minPercent: 0, mode };
    case 'contradiction':
      return { id, type, groupId: '', maxGap: 0, mode };
  }
}

export function ruleReady(rule: CleaningRule): boolean {
  switch (rule.type) {
    case 'duration':
      return rule.maxSeconds > 0;
    case 'straightline':
      return rule.groupId !== '';
    case 'screening':
      return rule.questionId !== '' && rule.option !== '';
    case 'completion':
      return rule.minPercent > 0 && rule.minPercent <= 100;
    case 'contradiction':
      return rule.groupId !== '' && rule.maxGap > 0;
  }
}

// 没有生效的规则、也没有单份例外时，清洗设置等于不存在。
export function hasCleaning(cleaning: Cleaning | undefined): boolean {
  return !!cleaning && (cleaning.rules.some(ruleReady) || !!cleaning.zeroMissing || Object.keys(cleaning.overrides).length > 0);
}

const DURATION_HEADER = /^(?:所用时间|答题时长|答卷时长|作答时长|填写时长|用时|耗时|duration(?:\s*\(s\))?)$/i;
const START_HEADER = /^(?:开始|起答).*(?:时间|日期)$/;
const END_HEADER = /^(?:结束|提交|完成).*(?:时间|日期)$/;

// 时长列的写法有数字（秒）、分:秒、时:分:秒和「X分Y秒」几种。
export function parseSeconds(raw: string | undefined): number | null {
  if (!isAnswer(raw)) return null;
  const s = (raw ?? '').trim();
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  const clock = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (clock) return clock[3] === undefined ? Number(clock[1]) * 60 + Number(clock[2]) : Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const zh = /^(?:(\d+)\s*小时)?(?:(\d+)\s*分)?(?:(\d+)\s*秒)?$/.exec(s);
  if (zh && (zh[1] || zh[2] || zh[3])) return (Number(zh[1]) || 0) * 3600 + (Number(zh[2]) || 0) * 60 + (Number(zh[3]) || 0);
  return null;
}

function parseTime(raw: string | undefined): number | null {
  if (!isAnswer(raw)) return null;
  const s = (raw ?? '').trim();
  let t = Date.parse(s);
  if (Number.isNaN(t)) {
    // 形如 21-Mar-2024 14:01:08 的写法，各个浏览器解析结果不一致，自己拆。
    const m = /^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (!m) return null;
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].findIndex((x) => m[2].toLowerCase().startsWith(x));
    if (month < 0) return null;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    t = new Date(year, month, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)).getTime();
  }
  return Number.isNaN(t) ? null : t;
}

export interface DurationInfo {
  title: string;
  // 每份问卷的时长（秒），读不出来的为 null。
  seconds: (number | null)[];
  median: number | null;
  unreadable: number;
  // 时长列和起止时间的差值对不上时的提示；一致或没法核对时为 null。
  warning: string | null;
}

export function durationInfo(dataset: Dataset): DurationInfo | null {
  const column = dataset.questions.find((q) => DURATION_HEADER.test(q.rawTitle.trim()));
  if (!column) return null;
  const seconds = dataset.rows.map((r) => parseSeconds(r[column.id]));
  const readable = seconds.filter((v): v is number => v !== null);
  const start = dataset.questions.find((q) => START_HEADER.test(q.rawTitle.trim()));
  const end = dataset.questions.find((q) => END_HEADER.test(q.rawTitle.trim()));
  let warning: string | null = null;
  if (start && end) {
    const ratios: number[] = [];
    dataset.rows.forEach((r, ri) => {
      const from = parseTime(r[start.id]);
      const to = parseTime(r[end.id]);
      const d = seconds[ri];
      if (from === null || to === null || d === null || to <= from) return;
      ratios.push(d / ((to - from) / 1000));
    });
    if (ratios.length >= 5) {
      const ratio = median(ratios) ?? 1;
      if (ratio < 0.9 || ratio > 1.1) {
        const gap = ratio >= 1 ? ratio : 1 / ratio;
        warning = `时长列「${column.rawTitle}」与起止时间的差值不一致，相差约 ${gap >= 10 ? Math.round(gap) : gap.toFixed(1)} 倍，请确认单位。`;
      }
    }
  }
  return { title: column.rawTitle, seconds, median: median(readable), unreadable: dataset.rows.length - readable.length, warning };
}

// 规律作答和矛盾规则用到的题组：只取纳入分析的量表子题，不足两道时不可用。
interface GroupContext {
  members: Question[];
  range: { min: number; max: number } | null;
}

function groupContext(dataset: Dataset, groupId: string): GroupContext | null {
  const members = dataset.questions.filter((q) => q.groupId === groupId && q.included && q.type === 'scale');
  if (members.length < 2) return null;
  return { members, range: scaleRange(members.map((q) => dataset.rows.map((r) => scaleScore(r[q.id])))) };
}

interface RuleContext {
  duration?: DurationInfo;
  included: Question[];
  group: GroupContext | null;
  question: Question | undefined;
}

function ruleHits(rule: CleaningRule, row: Record<string, string>, ri: number, ctx: RuleContext): boolean {
  switch (rule.type) {
    case 'duration': {
      const seconds = ctx.duration?.seconds[ri];
      return seconds !== undefined && seconds !== null && seconds < rule.maxSeconds;
    }
    case 'straightline': {
      if (!ctx.group) return false;
      const answers = ctx.group.members.map((q) => (row[q.id] ?? '').trim());
      return answers.every((v) => v !== '') && answers.every((v) => v === answers[0]);
    }
    case 'screening': {
      if (!ctx.question) return false;
      const raw = (row[ctx.question.id] ?? '').trim();
      return ctx.question.type === 'multi' ? splitMulti(raw).includes(rule.option) : raw === rule.option;
    }
    case 'completion': {
      if (ctx.included.length === 0) return false;
      const answered = ctx.included.filter((q) => isAnswer(row[q.id])).length;
      return answered / ctx.included.length < rule.minPercent / 100;
    }
    case 'contradiction': {
      const g = ctx.group;
      // 没有范围（全部缺失）或题组里缺正向、缺反向时都没法比。
      if (!g || !g.range) return false;
      let positive = 0;
      let negative = 0;
      let posSum = 0;
      let negSum = 0;
      for (const q of g.members) {
        const v = scaleScore(row[q.id]);
        if (v === null) return false;
        if (q.reversed) {
          negative++;
          negSum += g.range.min + g.range.max - v;
        } else {
          positive++;
          posSum += v;
        }
      }
      return positive > 0 && negative > 0 && Math.abs(posSum / positive - negSum / negative) > rule.maxGap + 1e-9;
    }
  }
}

export interface CleaningResult {
  status: RowStatus[];
  // 每份问卷命中的规则，列表里用来写原因。
  hits: CleaningRule[][];
  // 每条规则命中的份数，不受处理方式和单份例外的影响，面板预览用。
  counts: Record<string, number>;
}

// 参数没填的规则不参与；单份例外优先于规则。
export function evaluateCleaning(dataset: Dataset): CleaningResult {
  const cleaning = dataset.cleaning;
  const rules = (cleaning?.rules ?? []).filter(ruleReady);
  const n = dataset.rows.length;
  const duration = rules.some((r) => r.type === 'duration') ? (durationInfo(dataset) ?? undefined) : undefined;
  // 得分是从子题算出来的，不算进完成率的分母。
  const included = dataset.questions.filter((q) => q.included && !q.derived);
  const groups = new Map<string, GroupContext | null>();
  const hits: CleaningRule[][] = Array.from({ length: n }, () => []);
  const counts: Record<string, number> = {};
  for (const rule of rules) {
    counts[rule.id] = 0;
    const ctx: RuleContext = { duration, included, group: null, question: undefined };
    if (rule.type === 'straightline' || rule.type === 'contradiction') {
      if (!groups.has(rule.groupId)) groups.set(rule.groupId, groupContext(dataset, rule.groupId));
      ctx.group = groups.get(rule.groupId) ?? null;
      if (!ctx.group) continue;
    }
    if (rule.type === 'screening') {
      ctx.question = dataset.questions.find((q) => q.id === rule.questionId);
      if (!ctx.question) continue;
    }
    dataset.rows.forEach((row, ri) => {
      if (ruleHits(rule, row, ri, ctx)) {
        hits[ri].push(rule);
        counts[rule.id]++;
      }
    });
  }
  const overrides = cleaning?.overrides ?? {};
  const status = hits.map((list, ri): RowStatus => {
    if (overrides[ri] === 'drop') return 'excluded';
    if (overrides[ri] === 'keep') return 'valid';
    if (list.some((r) => r.mode === 'exclude')) return 'excluded';
    return list.length > 0 ? 'flagged' : 'valid';
  });
  return { status, hits, counts };
}

// 计入分析的问卷。没有清洗设置时就是原来的行数组，按数组身份缓存的统计才继续有效。
export function analysisRows(dataset: Dataset): Record<string, string>[] {
  const cleaning = dataset.cleaning;
  if (!cleaning || !hasCleaning(cleaning)) return dataset.rows;
  const { status } = evaluateCleaning(dataset);
  const kept = dataset.rows.filter((_, ri) => status[ri] === 'valid' || (status[ri] === 'flagged' && cleaning.includeFlagged));
  if (!cleaning.zeroMissing) return kept;
  return kept.map((row) => {
    const next = { ...row };
    for (const key of Object.keys(next)) if ((next[key] ?? '').trim() === '0') next[key] = '';
    return next;
  });
}

export function ruleLabel(rule: CleaningRule, dataset: Dataset): string {
  const groupTitle = (id: string) => dataset.groups.find((g) => g.id === id)?.title ?? '';
  const questionTitle = (id: string) => dataset.questions.find((q) => q.id === id)?.title ?? '';
  switch (rule.type) {
    case 'duration':
      return `作答时长低于 ${rule.maxSeconds} 秒`;
    case 'straightline':
      return `题组「${groupTitle(rule.groupId)}」全部选同一项`;
    case 'screening':
      return `「${questionTitle(rule.questionId)}」选了「${rule.option}」`;
    case 'completion':
      return `完成率低于 ${rule.minPercent}%`;
    case 'contradiction':
      return `题组「${groupTitle(rule.groupId)}」正反向题矛盾（差值超过 ${rule.maxGap}）`;
  }
}

export interface RuleSummary {
  rule: CleaningRule;
  label: string;
  // 剔除类规则：在被剔除的问卷里命中的份数；仅标记类：在被标记的问卷里命中的份数。
  count: number;
}

export interface CleaningSummary {
  total: number;
  excluded: number;
  flagged: number;
  // 实际进入统计的份数：有效的，加上计入分析的被标记问卷。
  analyzed: number;
  includeFlagged: boolean;
  rules: RuleSummary[];
  // 被剔除且同时命中两条以上剔除规则的份数。
  multiHit: number;
  // 命中剔除规则但手动保留的份数。
  kept: number;
  // 没有被规则剔除、手动剔除的份数。
  dropped: number;
}

export function cleaningSummary(dataset: Dataset): CleaningSummary | null {
  const cleaning = dataset.cleaning;
  if (!cleaning || !hasCleaning(cleaning)) return null;
  const { status, hits } = evaluateCleaning(dataset);
  const rules = cleaning.rules.filter(ruleReady).map((rule) => ({ rule, label: ruleLabel(rule, dataset), count: 0 }));
  let multiHit = 0;
  let kept = 0;
  let dropped = 0;
  hits.forEach((list, ri) => {
    for (const r of rules) {
      if (list.includes(r.rule) && status[ri] === (r.rule.mode === 'exclude' ? 'excluded' : 'flagged')) r.count++;
    }
    if (status[ri] === 'excluded' && list.filter((r) => r.mode === 'exclude').length >= 2) multiHit++;
    if (cleaning.overrides[ri] === 'keep' && list.some((r) => r.mode === 'exclude')) kept++;
    if (cleaning.overrides[ri] === 'drop') dropped++;
  });
  const excluded = status.filter((s) => s === 'excluded').length;
  const flagged = status.filter((s) => s === 'flagged').length;
  return {
    total: dataset.rows.length,
    excluded,
    flagged,
    analyzed: dataset.rows.length - excluded - (cleaning.includeFlagged ? 0 : flagged),
    includeFlagged: cleaning.includeFlagged,
    rules,
    multiHit,
    kept,
    dropped,
  };
}

// 报告里的清洗说明，可以直接抄进论文的数据处理一节。
export function cleaningSentence(s: CleaningSummary): string {
  const parts = [`共回收 ${s.total} 份`];
  const list = (mode: RuleMode) =>
    s.rules
      .filter((r) => r.rule.mode === mode && r.count > 0)
      .map((r) => `${r.label}的 ${r.count} 份`)
      .join('、');
  if (s.excluded > 0) {
    const reasons = [list('exclude'), s.dropped > 0 ? `手动剔除的 ${s.dropped} 份` : ''].filter(Boolean).join('、');
    parts.push(`剔除${reasons}${s.multiHit > 0 ? `（其中 ${s.multiHit} 份同时命中多条规则）` : ''}`);
  }
  parts.push(`最终有效 ${s.analyzed} 份`);
  if (s.flagged > 0) parts.push(`另有 ${s.flagged} 份被标记（${list('flag')}），${s.includeFlagged ? '已计入分析' : '未计入分析'}`);
  if (s.kept > 0) parts.push(`另有 ${s.kept} 份命中剔除规则但已手动保留`);
  return `${parts.join('，')}。`;
}

// 问卷在列表里的名字：优先用序号列的值，没有序号列时用数据行号。
export function rowLabels(dataset: Dataset): { labels: string[]; fromRowNumber: boolean } {
  const index = dataset.questions.find((q) => /^(?:序号|编号|问卷编号|答卷编号|id|no|num|index)$/i.test(q.rawTitle.trim()));
  if (!index) return { labels: dataset.rows.map((_, ri) => `第 ${ri + 1} 行`), fromRowNumber: true };
  return { labels: dataset.rows.map((r) => (r[index.id] ?? '').trim() || '?'), fromRowNumber: false };
}
