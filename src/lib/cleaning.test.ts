import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDataset } from './parse.ts';
import { analysisRows, cleaningSentence, cleaningSummary, durationInfo, evaluateCleaning, hasCleaning, newRule, parseSeconds, rowLabels, ruleReady } from './cleaning.ts';
import type { Cleaning, CleaningRule, Dataset, RuleType } from '../types.ts';

type Of<T extends RuleType> = Extract<CleaningRule, { type: T }>;
// 一条带参数的规则：类型决定默认的处理方式，参数由调用方给。
const rule = <T extends RuleType>(type: T, params: Partial<Of<T>>): Of<T> => ({ ...newRule(type), ...params }) as unknown as Of<T>;

// 5 份问卷：序号、时长、甄别题、一个三题的题组。
const make = (): Dataset =>
  buildDataset(
    [
      ['序号', '答题时长', '是否用过', '第1题(a)', '第1题(b)', '第1题(c)'],
      ['1', '45', '是', '3', '3', '3'],
      ['2', '300', '否', '1', '2', '3'],
      ['3', '', '是', '5', '4', '2'],
      ['4', '两分钟', '是', '2', '2', '2'],
      ['5', '90', '是', '1', '1', '1'],
    ],
    'x.csv',
    'UTF-8',
  );
const id = (ds: Dataset, rawTitle: string) => ds.questions.find((q) => q.rawTitle === rawTitle)!.id;
const withRules = (rules: CleaningRule[], extra: Partial<Cleaning> = {}): Dataset => {
  const ds = make();
  return { ...ds, cleaning: { rules, includeFlagged: true, overrides: {}, ...extra } };
};
const ids = (ds: Dataset, status: 'valid' | 'flagged' | 'excluded') => evaluateCleaning(ds).status.flatMap((s, i) => (s === status ? [i] : []));
const group = (ds: Dataset) => ds.groups[0].id;
const screening = (ds: Dataset, option: string) => rule('screening', { questionId: id(ds, '是否用过'), option });

test('a duration rule hits questionnaires under the threshold and leaves unreadable ones alone', () => {
  const ds = make();
  const info = durationInfo(ds)!;
  assert.equal(info.title, '答题时长');
  assert.deepEqual(info.seconds, [45, 300, null, null, 90]);
  assert.equal(info.median, 90);
  assert.equal(info.unreadable, 2);
  assert.equal(info.warning, null);
  const noColumn = { ...ds, questions: ds.questions.filter((q) => q.rawTitle !== '答题时长') };
  assert.equal(durationInfo(noColumn), null);

  const fast = rule('duration', { maxSeconds: 60 });
  const hit = withRules([fast]);
  assert.deepEqual(evaluateCleaning(hit).counts, { [fast.id]: 1 });
  assert.deepEqual(ids(hit, 'flagged'), [0]);
  assert.equal(newRule('duration').mode, 'flag');
});

test('the duration column is cross-checked against start and end times', () => {
  const grid = (scale: number) =>
    buildDataset(
      [
        ['序号', '开始答题时间', '结束答题时间', '答题时长', 'Q1'],
        ...Array.from({ length: 8 }, (_, i) => [String(i + 1), '21-Mar-2024 10:00:00', '21-Mar-2024 10:04:29', String(Math.round(269 * scale)), 'a']),
      ],
      'x.csv',
      'UTF-8',
    );
  assert.equal(durationInfo(grid(1))!.warning, null);
  // 单位是分或毫秒时两个数对不上，提示里写相差多少倍。
  assert.match(`${durationInfo(grid(1 / 60))!.warning}`, /相差约 67 倍/);
  assert.match(`${durationInfo(grid(1000))!.warning}`, /相差约 1000 倍/);
  // 没有起止时间就没法核对，也不该报错。
  assert.equal(durationInfo(make())!.warning, null);
});

test('seconds are read from plain numbers, clock notation and Chinese units', () => {
  assert.equal(parseSeconds('269'), 269);
  assert.equal(parseSeconds('4:29'), 269);
  assert.equal(parseSeconds('1:02:03'), 3723);
  assert.equal(parseSeconds('4分29秒'), 269);
  assert.equal(parseSeconds('1小时2分'), 3720);
  assert.equal(parseSeconds('两分钟'), null);
  assert.equal(parseSeconds('-'), null);
  assert.equal(parseSeconds(undefined), null);
});

test('a straight-line rule needs every scale item of the group answered with the same value', () => {
  const ds = withRules([rule('straightline', { groupId: group(make()) })]);
  assert.deepEqual(ids(ds, 'flagged'), [0, 3, 4]);
  // 题组里不足两道量表子题时，规则不生效。
  const broken = { ...ds, questions: ds.questions.map((q) => (q.rawTitle !== '第1题(a)' ? { ...q, included: false } : q)) };
  assert.deepEqual(evaluateCleaning(broken).status, Array(5).fill('valid'));
});

test('a screening rule hits a chosen option, in single- and multi-select questions alike', () => {
  assert.deepEqual(ids(withRules([screening(make(), '否')]), 'excluded'), [1]);
  assert.equal(newRule('screening').mode, 'exclude');

  const multi = buildDataset(
    [
      ['序号', '用过哪些', 'Q2'],
      ['1', 'A┋B', 'x'],
      ['2', 'C', 'y'],
      ['3', 'B', 'z'],
    ],
    'x.csv',
    'UTF-8',
  );
  const typed = { ...multi, questions: multi.questions.map((q) => (q.rawTitle === '用过哪些' ? { ...q, type: 'multi' as const } : q)) };
  const hit = { ...typed, cleaning: { rules: [rule('screening', { questionId: '用过哪些', option: 'B' })], includeFlagged: true, overrides: {} } };
  assert.deepEqual(ids(hit, 'excluded'), [0, 2]);
});

test('completion is measured against the analysed questions only', () => {
  const ds = withRules([rule('completion', { minPercent: 50 })]);
  // 每份都答了全部 4 道纳入的题；序号和时长是系统列，不算进分母。
  assert.deepEqual(ids(ds, 'flagged'), []);
  const thin = { ...ds, rows: ds.rows.map((r, i) => (i === 2 ? { ...r, '第1题(a)': '', '第1题(b)': '', '第1题(c)': '' } : r)) };
  // 第 3 份只答了 1/4 = 25%。
  assert.deepEqual(ids(thin, 'flagged'), [2]);
});

test('a contradiction rule compares positive and reversed items after flipping', () => {
  const base = make();
  const contradiction = rule('contradiction', { groupId: group(base), maxGap: 2 });
  // 题组里没有反向题时没法比，规则不生效。
  assert.deepEqual(ids(withRules([contradiction]), 'flagged'), []);
  // 第 5 份三题都是 1；把 c 标成反向后，正向均值 1、反向均值 5，差 4。
  const reversed = base.questions.map((q) => (q.rawTitle === '第1题(c)' ? { ...q, reversed: true } : q));
  assert.deepEqual(ids({ ...withRules([contradiction]), questions: reversed }, 'flagged'), [4]);
});

test('exclude beats flag, and flagged questionnaires count only when included', () => {
  const base = make();
  const fast = rule('duration', { maxSeconds: 60 });
  const both = withRules([fast, screening(base, '是')]);
  assert.deepEqual(ids(both, 'excluded'), [0, 2, 3, 4]);
  assert.deepEqual(ids(both, 'flagged'), []);

  assert.equal(analysisRows(withRules([fast])).length, 5);
  assert.equal(analysisRows(withRules([fast], { includeFlagged: false })).length, 4);
});

test('single overrides beat the rules', () => {
  const no = screening(make(), '否');
  const kept = withRules([no], { overrides: { 1: 'keep' } });
  assert.deepEqual(ids(kept, 'valid'), [0, 1, 2, 3, 4]);
  const dropped = withRules([], { overrides: { 4: 'drop' } });
  assert.deepEqual(ids(dropped, 'excluded'), [4]);
  assert.equal(analysisRows(dropped).length, 4);
});

test('without cleaning nothing changes and the original row array is reused', () => {
  const plain = make();
  assert.equal(hasCleaning(plain.cleaning), false);
  assert.equal(analysisRows(plain), plain.rows);
  // 参数没填的规则不算清洗设置。
  const empty = withRules([newRule('duration'), rule('completion', { minPercent: 0 })]);
  assert.equal(ruleReady(newRule('duration')), false);
  assert.equal(hasCleaning(empty.cleaning), false);
  assert.equal(analysisRows(empty), empty.rows);
});

test('the summary counts each rule among the questionnaires it removed or flagged', () => {
  const base = make();
  const ds = withRules([
    rule('duration', { maxSeconds: 60, mode: 'exclude' }),
    rule('straightline', { groupId: group(base), mode: 'exclude' }),
    screening(base, '否'),
  ]);
  const s = cleaningSummary(ds)!;
  assert.equal(s.total, 5);
  assert.deepEqual([s.excluded, s.flagged, s.analyzed, s.multiHit], [4, 0, 1, 1]);
  assert.deepEqual(
    s.rules.map((r) => [r.label, r.count]),
    [
      ['作答时长低于 60 秒', 1],
      ['题组「第1题」全部选同一项', 3],
      ['「是否用过」选了「否」', 1],
    ],
  );
  assert.equal(
    cleaningSentence(s),
    '共回收 5 份，剔除作答时长低于 60 秒的 1 份、题组「第1题」全部选同一项的 3 份、「是否用过」选了「否」的 1 份（其中 1 份同时命中多条规则），最终有效 1 份。',
  );
  assert.equal(cleaningSummary(make()), null);

  const kept = cleaningSummary(withRules([screening(base, '否')], { overrides: { 1: 'keep', 4: 'drop' } }))!;
  assert.deepEqual([kept.excluded, kept.kept, kept.dropped, kept.analyzed], [1, 1, 1, 4]);
  assert.equal(cleaningSentence(kept), '共回收 5 份，剔除手动剔除的 1 份，最终有效 4 份，另有 1 份命中剔除规则但已手动保留。');

  const flagged = cleaningSummary(withRules([rule('straightline', { groupId: group(base) })], { includeFlagged: false }))!;
  assert.equal(cleaningSentence(flagged), '共回收 5 份，最终有效 2 份，另有 3 份被标记（题组「第1题」全部选同一项的 3 份），未计入分析。');
});

test('questionnaires are named by the index column, or by row number when there is none', () => {
  assert.deepEqual(rowLabels(make()), { labels: ['1', '2', '3', '4', '5'], fromRowNumber: false });
  const noIndex = buildDataset(
    [
      ['Q1', 'Q2'],
      ['a', 'x'],
      ['b', 'y'],
    ],
    'x.csv',
    'UTF-8',
  );
  assert.deepEqual(rowLabels(noIndex), { labels: ['第 1 行', '第 2 行'], fromRowNumber: true });
});
