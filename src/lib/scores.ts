import type { Dataset, Question, QuestionGroup, ScoreForm, ScoreMissing } from '../types.ts';
import { scaleConsistent, scaleRange, scaleScore } from './reliability.ts';

export const SCORE_MISSING_LABELS: Record<ScoreMissing, string> = {
  complete: '全部子项都作答',
  partial80: '至少 80% 子项有作答',
};

export const SCORE_FORM_LABELS: Record<ScoreForm, string> = {
  mean: '均值',
  sum: '求和',
  z: 'z 分',
};

// 得分题目的 id 由题组决定，同一个题组始终是同一个 id。
export const scoreId = (groupId: string) => `score:${groupId}`;

// 有两道以上量表子题的题组，维度得分的状态。
export interface ScoreState {
  group: QuestionGroup;
  // 纳入分析的量表子题。
  members: Question[];
  // 各子题在每一行上的得分，没有作答的为 null。
  columns: (number | null)[][];
  range: { min: number; max: number } | null;
  // 不能生成得分的原因；可以生成时为 null。
  blocker: string | null;
  // 已生成时是缺失规则，没有生成为 null。
  missing: ScoreMissing | null;
  // 得分形式：均值（默认）、求和、z 分。
  form: ScoreForm;
  // z 分的标准化参数：按计入分析的问卷算出的均值分均值与样本标准差；标准差为 0 时为 null。
  z: { mu: number; sd: number } | null;
  // 可以生成时存在；定义不变时是同一个对象，统计缓存靠它命中。
  question: Question | null;
}

// 派生题目的身份按题组对象、成员和形式缓存，无关的编辑不会让它换新。
const derivedCache = new WeakMap<QuestionGroup, { key: string; question: Question }>();

function derivedQuestion(group: QuestionGroup, members: Question[], form: ScoreForm): Question {
  const key = `${members.map((q) => q.id + (q.reversed ? '+' : '')).join('|')}#${form}`;
  const cached = derivedCache.get(group);
  if (cached && cached.key === key) return cached.question;
  const question: Question = {
    id: scoreId(group.id),
    title: `${group.title} 得分`,
    rawTitle: group.title,
    type: 'numeric',
    included: true,
    derived: { kind: 'score', groupId: group.id },
  };
  derivedCache.set(group, { key, question });
  return question;
}

// 第 ri 行按缺失规则得到的均值分与已作答子题数；算不出时为 null。反向题先按题组的翻转范围折回去。
function meanScore(state: Omit<ScoreState, 'form' | 'z' | 'question'>, ri: number) {
  const range = state.range;
  if (!range) return null;
  let sum = 0;
  let answered = 0;
  state.columns.forEach((col, j) => {
    const v = col[ri];
    if (v === null) return;
    answered++;
    sum += state.members[j].reversed ? range.min + range.max - v : v;
  });
  const need = state.missing === 'partial80' ? Math.ceil((state.members.length * 80) / 100) : state.members.length;
  if (answered < need) return null;
  return { mean: sum / answered, answered };
}

// z 分的参数：均值分在计入分析的问卷上的均值与样本标准差（n − 1）。
function zParams(state: Omit<ScoreState, 'form' | 'z' | 'question'>, rowCount: number) {
  const xs: number[] = [];
  for (let ri = 0; ri < rowCount; ri++) {
    const m = meanScore(state, ri);
    if (m) xs.push(m.mean);
  }
  if (xs.length < 2) return null;
  const mu = xs.reduce((s, x) => s + x, 0) / xs.length;
  const ss = xs.reduce((s, x) => s + (x - mu) ** 2, 0);
  const sd = Math.sqrt(ss / (xs.length - 1));
  return sd > 0 ? { mu, sd } : null;
}

export function scoreStates(dataset: Dataset, rows: Record<string, string>[]): ScoreState[] {
  return dataset.groups.flatMap((group) => {
    const members = dataset.questions.filter((q) => q.groupId === group.id && q.included && q.type === 'scale');
    if (members.length < 2) return [];
    const columns = members.map((q) => rows.map((r) => scaleScore(r[q.id])));
    const range = scaleRange(columns);
    const blocker = !range ? '这些题没有有效回答' : !scaleConsistent(columns) ? '各题取值范围不一致（如 1–5 分与 0–10 分混在一起）' : null;
    const missing = dataset.scores?.[group.id] ?? null;
    const form: ScoreForm = dataset.scoreForms?.[group.id] ?? 'mean';
    const base = { group, members, columns, range, blocker, missing };
    return [{ ...base, form, z: form === 'z' ? zParams(base, rows.length) : null, question: blocker === null ? derivedQuestion(group, members, form) : null }];
  });
}

// 第 ri 行的得分；按算分条件算不出时为 null。
export function scoreAt(state: ScoreState, ri: number): number | null {
  const m = meanScore(state, ri);
  if (!m) return null;
  if (state.form === 'sum') return m.mean * m.answered;
  if (state.form === 'z') return state.z ? (m.mean - state.z.mu) / state.z.sd : null;
  return m.mean;
}

// 给每一行补上得分列。没有得分时原样返回同一个数组。
export function withScores(rows: Record<string, string>[], states: ScoreState[]): Record<string, string>[] {
  const live = states.filter((s) => s.question && s.missing);
  if (live.length === 0) return rows;
  return rows.map((row, ri) => {
    const scored = { ...row };
    for (const s of live) {
      const v = scoreAt(s, ri);
      scored[s.question!.id] = v === null ? '' : String(v);
    }
    return scored;
  });
}

// missing 为 null 表示移除得分。最后一份得分移除后 scores 字段一并去掉。
export function setScore(dataset: Dataset, groupId: string, missing: ScoreMissing | null): Dataset {
  const scores = { ...(dataset.scores ?? {}) };
  if (missing === null) delete scores[groupId];
  else scores[groupId] = missing;
  return { ...dataset, scores: Object.keys(scores).length > 0 ? scores : undefined };
}

// 改变得分形式；均值是缺省值，所以选回均值时把条目删掉。
export function setScoreForm(dataset: Dataset, groupId: string, form: ScoreForm): Dataset {
  const scoreForms = { ...(dataset.scoreForms ?? {}) };
  if (form === 'mean') delete scoreForms[groupId];
  else scoreForms[groupId] = form;
  return { ...dataset, scoreForms: Object.keys(scoreForms).length > 0 ? scoreForms : undefined };
}

// 得分卡片和报告里的口径说明。
export function scoreNote(question: Question, dataset: Dataset): string {
  const groupId = question.derived?.groupId;
  if (!groupId) return '';
  const group = dataset.groups.find((g) => g.id === groupId);
  const members = dataset.questions.filter((q) => q.groupId === groupId && q.included && q.type === 'scale');
  const rule = dataset.scores?.[groupId];
  const form = dataset.scoreForms?.[groupId] ?? 'mean';
  const flipped = members.some((q) => q.reversed) ? '，反向题已翻转' : '';
  const what = form === 'mean' ? '的均值' : form === 'sum' ? '之和' : '均值的 z 分';
  const how = form === 'z' ? '（按计入分析的问卷做样本标准化）' : '';
  return `题组「${group?.title ?? ''}」${members.length} 道量表子题${what}${flipped}${how}；只算${rule ? SCORE_MISSING_LABELS[rule] : ''}的问卷。`;
}
