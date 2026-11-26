import type { Dataset, Question, QuestionGroup } from '../types.ts';

export type CardItem =
  | { kind: 'question'; question: Question }
  | { kind: 'group'; group: QuestionGroup; questions: Question[] };

export function includedItems(dataset: Dataset): CardItem[] {
  const included = dataset.questions.filter((q) => q.included);
  const counts = new Map<string, number>();
  for (const q of included) if (q.groupId) counts.set(q.groupId, (counts.get(q.groupId) ?? 0) + 1);
  const groups = new Map(dataset.groups.map((g) => [g.id, g]));
  const seen = new Set<string>();
  const items: CardItem[] = [];
  for (const q of included) {
    if (!q.groupId || (counts.get(q.groupId) ?? 0) < 2) {
      items.push({ kind: 'question', question: q });
    } else if (!seen.has(q.groupId)) {
      seen.add(q.groupId);
      const group = groups.get(q.groupId);
      if (group) items.push({ kind: 'group', group, questions: included.filter((x) => x.groupId === q.groupId) });
      else items.push({ kind: 'question', question: q });
    }
  }
  return items;
}

function prune(dataset: Dataset): Dataset {
  const groups = dataset.groups
    .map((g) => ({ ...g, questionIds: g.questionIds.filter((id) => dataset.questions.some((q) => q.id === id && q.groupId === g.id)) }))
    .filter((g) => g.questionIds.length >= 2);
  const live = new Set(groups.map((g) => g.id));
  return {
    ...dataset,
    groups,
    questions: dataset.questions.map((q) => (q.groupId && !live.has(q.groupId) ? { ...q, groupId: undefined } : q)),
  };
}

export function toggleIncluded(dataset: Dataset, id: string): Dataset {
  const q = dataset.questions.find((x) => x.id === id);
  if (!q) return dataset;
  const ids = new Set(q.groupId ? dataset.questions.filter((x) => x.groupId === q.groupId).map((x) => x.id) : [q.id]);
  const included = !q.included;
  return {
    ...dataset,
    questions: dataset.questions.map((x) =>
      ids.has(x.id) ? { ...x, included, ...(included && !q.groupId && x.type === 'meta' ? { type: 'single' as const } : {}) } : x,
    ),
  };
}

export function mergeQuestions(dataset: Dataset, ids: string[], title: string): Dataset {
  const selected = new Set(ids);
  const members = dataset.questions.filter((q) => selected.has(q.id));
  if (members.length < 2) return dataset;
  const id = `g:m:${members.map((m) => m.id).join('|')}`;
  const group: QuestionGroup = { id, title: title.trim() || members[0].title, questionIds: members.map((m) => m.id) };
  return prune({
    ...dataset,
    groups: [...dataset.groups.filter((g) => !g.questionIds.some((qid) => selected.has(qid))), group],
    questions: dataset.questions.map((q) => (selected.has(q.id) ? { ...q, groupId: id } : q)),
  });
}

export function splitGroup(dataset: Dataset, groupId: string): Dataset {
  return prune({
    ...dataset,
    groups: dataset.groups.filter((g) => g.id !== groupId),
    questions: dataset.questions.map((q) => (q.groupId === groupId ? { ...q, groupId: undefined, subTitle: undefined } : q)),
  });
}