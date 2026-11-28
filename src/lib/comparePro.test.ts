import assert from 'node:assert/strict';
import test from 'node:test';
import { compareQuestions } from './compare.ts';
import { withProMode } from './comparePro.ts';
import { PRO_MODE_OFF, PRO_MODE_ON } from '../types.ts';
import type { ProModeOptions, Question } from '../types.ts';

const q = (id: string, title: string, type: Question['type']): Question => ({ id, title, rawTitle: title, type, included: true });

const questions = [q('g', '年级', 'single'), q('m', '满意度', 'scale')];
const rows: Record<string, string>[] = [];
const grades = ['大一', '大二', '大三'];
for (let i = 0; i < 60; i++) rows.push({ g: grades[i % 3], m: String(1 + ((i * 7) % 5)) });

const base = () => {
  const comparison = compareQuestions(questions[0], questions[1], rows, { deferBootstrap: true });
  assert.ok(comparison);
  return comparison;
};

test('pro mode off returns the default comparison untouched', () => {
  const comparison = base();
  assert.equal(withProMode(comparison, PRO_MODE_OFF), comparison);
});

test('Holm correction only changes decisions, not the intervals', () => {
  const comparison = base();
  const pro: ProModeOptions = { ...PRO_MODE_ON, rankTest: false, spearman: false };
  const adjusted = withProMode(comparison, pro);
  const raw = comparison.rows[0].diffs;
  const next = adjusted.rows[0].diffs;
  assert.equal(next.length, raw.length);
  for (let i = 0; i < next.length; i++) {
    const a = raw[i];
    const b = next[i];
    if (!a || !b) continue;
    assert.equal(b.lower, a.lower);
    assert.equal(b.upper, a.upper);
    assert.equal(b.diff, a.diff);
    assert.ok(b.pAdjusted !== null && b.pAdjusted !== undefined);
    assert.equal(b.clear, (b.pAdjusted as number) < 0.05);
  }
  assert.deepEqual(adjusted.adjust, { method: 'holm', m: raw.filter((d) => d && d.p !== null).length });
  assert.match(adjusted.sentence, /Holm 校正/);
  assert.doesNotMatch(adjusted.sentence, /没有看到明确差别（高 0/);
});

test('rank test adds Mann–Whitney pairs and an overall Kruskal–Wallis line', () => {
  const comparison = base();
  const pro: ProModeOptions = { ...PRO_MODE_OFF, on: true, rankTest: true };
  const ranked = withProMode(comparison, pro);
  assert.ok(ranked.rank);
  assert.equal(ranked.rank.pairs.length, 2);
  assert.ok(ranked.rank.overall);
  assert.match(ranked.sentence, /Mann–Whitney/);
  assert.match(ranked.sentence, /Kruskal–Wallis/);
  assert.equal(ranked.rows[0].diffs[0]?.rankP !== undefined, true);
});

test('multi-option tests carry adjusted p values', () => {
  const multi = [q('g', '年级', 'single'), q('m', '用过的工具', 'multi')];
  const sample: Record<string, string>[] = [];
  for (let i = 0; i < 60; i++) sample.push({ g: grades[i % 3], m: ['A;B', 'A', 'B;C', 'C', 'A;C'][i % 5] });
  const comparison = compareQuestions(multi[0], multi[1], sample, { deferBootstrap: true });
  assert.ok(comparison);
  const adjusted = withProMode(comparison, { ...PRO_MODE_ON, rankTest: false });
  assert.ok(adjusted.adjust);
  assert.match(adjusted.sentence, /p 值已按 Holm 校正/);
  for (const row of adjusted.rows) {
    if (row.test) assert.ok(row.test.pAdjusted !== undefined);
  }
});
