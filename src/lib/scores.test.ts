import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Dataset } from '../types.ts';
import { buildDataset } from './parse.ts';
import { scoreId, scoreNote, scoreStates, setScore, withScores } from './scores.ts';
import { evaluateCleaning, newRule } from './cleaning.ts';
import { computeStat, validRowCount } from './stats.ts';

// 一个 5 道量表子题的题组，外加一道单选题。第 2 份答了 3 道，第 3 份答了 4 道。
const make = (): Dataset =>
  buildDataset(
    [
      ['序号', '是否用过', '第1题(a)', '第1题(b)', '第1题(c)', '第1题(d)', '第1题(e)'],
      ['1', '是', '4', '3', '4', '3', '1'],
      ['2', '否', '4', '2', '4', '', ''],
      ['3', '是', '4', '1', '4', '', '4'],
      ['4', '否', '1', '4', '1', '1', '1'],
    ],
    'x.csv',
    'UTF-8',
  );
const generated = (missing: 'complete' | 'partial80' = 'complete'): Dataset => {
  const ds = make();
  return setScore(ds, ds.groups[0].id, missing);
};
const values = (ds: Dataset) => {
  const state = scoreStates(ds, ds.rows)[0];
  return withScores(ds.rows, [state]).map((r) => r[scoreId(ds.groups[0].id)]);
};
const noteOf = (ds: Dataset) => scoreNote(scoreStates(ds, ds.rows)[0].question!, ds);

test('a score is the mean of the items and exists only when the user asks for it', () => {
  const ds = make();
  assert.equal(ds.scores, undefined);
  assert.equal(scoreStates(ds, ds.rows)[0].missing, null);
  // 没有生成得分时行数组原样返回。
  assert.equal(withScores(ds.rows, scoreStates(ds, ds.rows)), ds.rows);

  assert.deepEqual(values(generated()), ['3', '', '', String(8 / 5)]);
  const once = setScore(ds, ds.groups[0].id, 'complete');
  const twice = setScore(once, ds.groups[0].id, 'partial80');
  assert.deepEqual(twice.scores, { [ds.groups[0].id]: 'partial80' });
  assert.equal(setScore(twice, ds.groups[0].id, null).scores, undefined);
  assert.equal(noteOf(generated()), '题组「第1题」5 道量表子题的均值；要求全部子项都作答。');
});

test('the missing-data rule decides who gets a score', () => {
  // 5 道子题至少答 4 道才算：第 2 份只答了 3 道，第 3 份答了 4 道。
  assert.deepEqual(values(generated('partial80')), ['3', '', String(13 / 4), String(8 / 5)]);
  assert.deepEqual(values(generated('complete')), ['3', '', '', String(8 / 5)]);
});

test('reversed items are flipped on the group range before averaging', () => {
  const base = make();
  const reversed = { ...base, questions: base.questions.map((q) => (q.rawTitle === '第1题(c)' ? { ...q, reversed: true } : q)) };
  const ds = setScore(reversed, base.groups[0].id, 'complete');
  // 翻转范围是各题观测范围的并集 1–4。第 1 份：4、3、(5−4)、3、1；第 4 份：1、4、(5−1)、1、1。
  assert.deepEqual(values(ds), [String(12 / 5), '', '', String(11 / 5)]);
  assert.equal(noteOf(ds), '题组「第1题」5 道量表子题的均值，反向题已翻转；要求全部子项都作答。');
});

test('text Likert labels and numbers are scored the same way as for reliability', () => {
  const parsed = buildDataset(
    [
      ['序号', '第2题(a)', '第2题(b)'],
      ['1', '4', '非常满意'],
      ['2', '不满意', '2'],
    ],
    'x.csv',
    'UTF-8',
  );
  // 两行的数据太少，推断不出量表，这里直接按量表处理。
  const ds = setScore({ ...parsed, questions: parsed.questions.map((q) => (q.groupId ? { ...q, type: 'scale' as const } : q)) }, parsed.groups[0].id, 'complete');
  assert.deepEqual(values(ds), ['4.5', '2']);
});

test('groups that cannot be scored say why, and the derived question keeps its identity across unrelated edits', () => {
  const base = make();
  const state = scoreStates(base, base.rows)[0];
  assert.equal(state.blocker, null);
  assert.equal(state.question?.derived?.groupId, base.groups[0].id);
  // 无关的编辑（忽略单选题）之后，派生题目还是同一个对象。
  const edited = { ...base, questions: base.questions.map((q) => (q.rawTitle === '是否用过' ? { ...q, included: false } : q)) };
  assert.equal(scoreStates(edited, edited.rows)[0].question, state.question);
  // 子项的反向标记变了，得分跟着变，派生题目换新。
  const flipped = { ...base, questions: base.questions.map((q) => (q.rawTitle === '第1题(a)' ? { ...q, reversed: true } : q)) };
  assert.notEqual(scoreStates(flipped, flipped.rows)[0].question, state.question);

  // 一道 1–5 分，一道 1–10 分的题被放进了同一个题组。
  const wide = buildDataset(
    [
      ['序号', '第3题(a)', '第3题(b)'],
      ...Array.from({ length: 14 }, (_, i) => [String(i + 1), String(1 + (i % 5)), String(1 + (i % 10))]),
    ],
    'x.csv',
    'UTF-8',
  );
  assert.match(`${scoreStates(wide, wide.rows)[0].blocker}`, /取值范围不一致/);
  assert.equal(scoreStates(wide, wide.rows)[0].question, null);
  const blank = { ...base, rows: base.rows.map((r) => ({ ...r, '第1题(a)': '', '第1题(b)': '', '第1题(c)': '', '第1题(d)': '', '第1题(e)': '' })) };
  assert.match(`${scoreStates(blank, blank.rows)[0].blocker}`, /没有有效回答/);
  // 只剩一道量表子题的题组不会出现在得分状态里。
  const one = { ...base, questions: base.questions.map((q) => (['第1题(b)', '第1题(c)', '第1题(d)', '第1题(e)'].includes(q.rawTitle) ? { ...q, included: false } : q)) };
  assert.deepEqual(scoreStates(one, one.rows), []);
});

test('a score behaves like a numeric question without changing cleaning or sample counts', () => {
  const ds = generated();
  const state = scoreStates(ds, ds.rows)[0];
  const rows = withScores(ds.rows, [state]);
  const view = { ...ds, questions: [...ds.questions, state.question!] };
  const stat = computeStat(state.question!, rows);
  assert.equal(stat.kind === 'numeric' && stat.n, 2);
  assert.equal(stat.kind === 'numeric' && stat.missing, 2);
  assert.equal(validRowCount(view, rows), validRowCount(ds, ds.rows));

  // 完成率的分母还是原来的 6 道题，得分不算进去。
  // 第 3 份答了 6 道里的 5 道（83%），把得分算进去就只有 5/7（71%），会被 75% 的阈值误伤。
  const thin = { ...view, rows, cleaning: { rules: [{ ...newRule('completion'), minPercent: 75 }], includeFlagged: true, overrides: {} } };
  assert.deepEqual(
    evaluateCleaning(thin).status,
    evaluateCleaning({ ...ds, cleaning: thin.cleaning }).status,
  );
});
