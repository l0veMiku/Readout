import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildDataset, parseCsv } from './parse.ts';
import { detectProfile, EXPORT_PROFILES } from './exportProfiles.ts';
import { withUserSchema } from './schemaInference.ts';
import { computeStat } from './stats.ts';

function fixture(name: string) {
  const text = readFileSync(new URL(`../../fixtures/surveys/${name}`, import.meta.url), 'utf8').replace(/^\ufeff/, '');
  const grid = parseCsv(text);
  return buildDataset(grid, name, 'UTF-8');
}

test('platform detection uses more than one header signal', () => {
  assert.equal(detectProfile(['序号', '提交答卷时间', '所用时间', '来源详情']).id, 'wjx');
  assert.equal(detectProfile(['编号', '开始答题时间', '结束答题时间', '答题时长']).id, 'tencent');
  assert.equal(detectProfile(['ResponseID', 'ResponseSet', 'StartDate', 'Finished']).id, 'qualtrics');
  assert.equal(detectProfile(['Timestamp', 'How happy?']).id, 'google-forms');
  assert.equal(detectProfile(['编号']).id, 'generic');
  assert.deepEqual(EXPORT_PROFILES.map((p) => p.id), ['wjx', 'tencent', 'qualtrics', 'google-forms', 'generic']);
});

test('问卷星 option columns merge and system columns stay metadata', () => {
  const ds = fixture('wjx-system.csv');
  assert.equal(ds.format?.id, 'wjx');
  const multi = ds.questions.find((q) => q.rawTitle.includes('第2题'));
  assert.ok(multi, 'multi question exists');
  assert.equal(multi?.type, 'multi');
  assert.equal(ds.questions.find((q) => q.rawTitle === '序号')?.type, 'meta');
  assert.equal(ds.questions.some((q) => q.rawTitle.includes('第2题(微信)')), false);
});

test('腾讯 colon option columns become one multi question', () => {
  const ds = fixture('tencent-multi.csv');
  assert.equal(ds.format?.id, 'tencent');
  const multi = ds.questions.find((q) => q.title.includes('满意之处'));
  assert.ok(multi);
  assert.equal(multi?.type, 'multi');
  const stat = computeStat(multi!, ds.rows);
  assert.equal(stat.kind, 'multi');
  if (stat.kind === 'multi') {
    assert.deepEqual([...stat.options.map((o) => o.name)].sort(), ['价格', '服务', '环境'].sort());
    assert.deepEqual(stat.options.map((o) => o.count), [2, 2, 2]);
  }
  const note = ds.questions.find((q) => q.rawTitle.includes('选项填空'));
  assert.ok(note);
  assert.notEqual(note?.type, 'multi');
});

test('Qualtrics matrix columns group, NA counts as missing, _TEXT stays out of options', () => {
  const ds = fixture('qualtrics-matrix.csv');
  assert.equal(ds.format?.id, 'qualtrics');
  const group = ds.groups.find((g) => g.title === 'Q5');
  assert.ok(group);
  assert.equal(group?.questionIds.length, 4);
  assert.equal(ds.questions.find((q) => q.rawTitle === 'ResponseID')?.type, 'meta');
  assert.equal(ds.questions.find((q) => q.rawTitle === 'Finished')?.type, 'meta');
  const q1 = ds.questions.find((q) => q.rawTitle === 'Q1');
  assert.ok(q1);
  const stat = computeStat(q1!, ds.rows);
  assert.equal(stat.n, 2);
  assert.equal(stat.missing, 1);
  assert.ok(ds.questions.find((q) => q.rawTitle === 'Q6_TEXT'));
});

test('Google Forms single 1-5 scale is low confidence and suggests scale', () => {
  const ds = fixture('forms-scale.csv');
  assert.equal(ds.format?.id, 'google-forms');
  const happy = ds.questions.find((q) => q.rawTitle.includes('happy'))!;
  assert.equal(happy.type, 'single');
  assert.equal(happy.schema?.confidence, 'low');
  assert.equal(happy.schema?.suggested, 'scale');
  assert.equal(ds.questions.some((q) => q.rawTitle.includes('Thanks for taking part! (2)')), false);
});


test('user type changes are marked and not overwritten by inference metadata', () => {
  const q = { id: 'q', title: 't', rawTitle: 't', type: 'single' as const, included: true };
  const changed = withUserSchema(q, 'scale');
  assert.equal(changed.type, 'scale');
  assert.equal(changed.schema?.source, 'user');
  assert.equal(changed.schema?.confirmed, true);
});
