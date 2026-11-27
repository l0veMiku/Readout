import type { Dataset, Question, QuestionGroup, ScoreMissing } from '../types.ts';
import { scaleConsistent, scaleRange, scaleScore } from './reliability.ts';

export const SCORE_MISSING_LABELS: Record<ScoreMissing, string> = {
  complete: '全部子项都作答',
  partial80: '至少 80% 子项有作答',
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
  // 可以生成时存在；定义不变时是同一个对象，统计缓存靠它命中。
  question: Question | null;
}

// 派生题目的身份按题组对象和成员缓存，无关的编辑不会让它换新。
const derivedCache = new WeakMap<QuestionGroup, { key: string; question: Question }>();

function derivedQuestion(group: QuestionGroup, members: Question[]): Question {
  const key = members.map((q) => q.id + (q.reversed ? '+' : '')).join('|');
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

export function scoreStates(dataset: Dataset, rows: Record<string, string>[]): ScoreState[] {
  return dataset.groups.flatMap((group) => {
    const members = dataset.questions.filter((q) => q.groupId === group.id && q.included && q.type === 'scale');
    if (members.length < 2) return [];
    const columns = members.map((q) => rows.map((r) => scaleScore(r[q.id])));
    const range = scaleRange(columns);
    const blocker = !range ? '这些题没有有效回答' : !scaleConsistent(columns) ? '各题取值范围不一致（如 1–5 分与 0–10 分混在一起）' : null;
    const missing = dataset.scores?.[group.id] ?? null;
    return [{ group, members, columns, range, blocker, missing, question: blocker === null ? derivedQuestion(group, members) : null }];
  });
}

// 第 ri 行的得分；按缺失规则算不出时为 null。反向题先按题组的翻转范围折回去。
export function scoreAt(state: ScoreState, ri: number): number | null {
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
  return answered >= need ? sum / answered : null;
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

// 得分卡片和报告里的口径说明。
export function scoreNote(question: Question, dataset: Dataset): string {
  const groupId = question.derived?.groupId;
  if (!groupId) return '';
  const group = dataset.groups.find((g) => g.id === groupId);
  const members = dataset.questions.filter((q) => q.groupId === groupId && q.included && q.type === 'scale');
  const rule = dataset.scores?.[groupId];
  const flipped = members.some((q) => q.reversed) ? '，反向题已翻转' : '';
  return `题组「${group?.title ?? ''}」${members.length} 道量表子题的均值${flipped}；只算${rule ? SCORE_MISSING_LABELS[rule] : ''}的问卷。`;
}
