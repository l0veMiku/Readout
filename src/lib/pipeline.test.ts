import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Question, QuestionType } from '../types.ts';
import { inferType } from './infer.ts';
import { buildDataset, decodeText, parseGrid } from './parse.ts';
import { buildFindings, computeStat, sampleNote } from './stats.ts';

function demoDataset() {
  const text: string = readFileSync(new URL('../../public/demo-survey.csv', import.meta.url), 'utf8');
  const grid = text.replace(/^\ufeff/, '').split(/\r?\n/).filter((l) => l !== '').map((l) => l.split(','));
  return buildDataset(grid, 'demo-survey.csv', 'UTF-8');
}

test('demo survey: every question type is inferred as designed', () => {
  const ds = demoDataset();
  assert.equal(ds.rows.length, 128);
  assert.deepEqual(ds.questions.map((q) => q.type), [
    'meta', 'meta', 'single', 'single', 'single', 'single', 'multi', 'multi',
    'scale', 'scale', 'numeric', 'numeric', 'open', 'multi', 'open',
  ]);
  assert.equal(ds.questions[2].title, '您的年级是？');
  assert.equal(ds.questions[6].title, '您使用过哪些 AI 工具？');
  assert.equal(ds.questions.filter((q) => q.included).length, 13);
});

test('multi-select splits on separators and counts people, not ticks', () => {
  const q = { id: 'q', title: 't', rawTitle: 'q', type: 'multi' as const, included: true };
  const rows = ['A┋B', 'B┋B', 'A', '-'].map((v) => ({ q: v }));
  const s = computeStat(q, rows);
  assert.equal(s.kind, 'multi');
  if (s.kind !== 'multi') return;
  assert.equal(s.n, 3);
  assert.equal(s.missing, 1);
  assert.deepEqual(s.options.map((o) => [o.name, o.count]), [['A', 2], ['B', 2]]);
  assert.equal(s.avgSelected, 4 / 3);
});

test('scale, numeric and open stats follow the documented definitions', () => {
  const mk = (type: QuestionType): Question => ({ id: 'q', title: 't', rawTitle: 'q', type, included: true });
  const rowsOf = (values: string[]) => values.map((v) => ({ q: v }));
  const scale = computeStat(mk('scale'), rowsOf(['5', '4', '5', '2', '未填写']));
  assert.equal(scale.kind, 'scale');
  if (scale.kind !== 'scale') return;
  assert.equal(scale.mean, 4);
  assert.equal(scale.median, 4.5);
  assert.ok(scale.sd !== null && Math.abs(scale.sd - Math.SQRT2) < 1e-9);
  assert.equal(scale.top2, 0.75);

  const numeric = computeStat(mk('numeric'), rowsOf(['1', '2', '3']));
  assert.equal(numeric.kind, 'numeric');
  if (numeric.kind !== 'numeric') return;
  assert.deepEqual([numeric.min, numeric.max, numeric.median], [1, 3, 2]);
  assert.ok(numeric.bins.length >= 1 && numeric.bins.length <= 11);
  assert.deepEqual(numeric.bins.map((b) => b.name), ['1–1.2', '1.2–1.4', '1.4–1.6', '1.6–1.8', '1.8–2', '2–2.2', '2.2–2.4', '2.4–2.6', '2.6–2.8', '2.8–3']);
  assert.equal(numeric.bins.reduce((s, b) => s + b.count, 0), 3);
  assert.equal(numeric.bins[0].count, 1);

  const hours = computeStat(mk('numeric'), rowsOf(['0', '3', '7', '43', '20', '20', '20', '21', '43']));
  if (hours.kind !== 'numeric') return;
  assert.deepEqual(hours.bins.map((b) => b.name), ['0–5', '5–10', '10–15', '15–20', '20–25', '25–30', '30–35', '35–40', '40–45']);
  assert.deepEqual(hours.bins.map((b) => b.count), [2, 1, 0, 0, 4, 0, 0, 0, 2]);

  const open = computeStat(mk('open'), rowsOf(['很好用', '', '一般般吧']));
  assert.equal(open.kind, 'open');
  if (open.kind !== 'open') return;
  assert.equal(open.n, 2);
  assert.equal(open.avgChars, 3.5);

  const empty = computeStat(mk('single'), rowsOf(['', ' ']));
  assert.equal(empty.n, 0);
  assert.equal(empty.missing, 2);
});

test('findings name the option with the most answers and mix question kinds', () => {
  const ds = demoDataset();
  const findings = buildFindings(ds.rows, ds.questions);
  assert.ok(findings.length >= 3 && findings.length <= 6);
  assert.ok(findings.every((f) => f.endsWith('。')));
  assert.ok(findings.some((f) => f.includes('平均')), 'scale or numeric findings are present');
  assert.ok(findings.some((f) => f.includes('里选择最多')), 'multi-select findings are present');
  const topTool = computeStat(ds.questions[6], ds.rows);
  if (topTool.kind === 'multi') {
    const text = findings.find((f) => f.includes(ds.questions[6].title));
    assert.ok(text?.includes(`「${topTool.options[0].name}」`));
  }
  const least = computeStat(ds.questions[2], ds.rows);
  if (least.kind === 'single') assert.ok(least.options.every((o, i, a) => i === 0 || a[i - 1].count >= o.count));
});

test('every proportion and mean carries a 95% interval, and small samples are flagged', () => {
  const ds = demoDataset();
  const stats = Object.fromEntries(ds.questions.map((q) => [q.id, computeStat(q, ds.rows)]));
  for (const q of ds.questions.filter((x) => x.included && x.type !== 'open')) {
    const s = stats[q.id];
    const rows = s.kind === 'single' || s.kind === 'multi' ? s.options : s.kind === 'scale' ? s.levels : [];
    for (const r of rows) {
      assert.ok(r.ci, `${q.title} / ${r.name} has an interval`);
      assert.ok(r.ci.lower <= r.pct && r.pct <= r.ci.upper, `${q.title} / ${r.name} interval covers the estimate`);
      assert.ok(r.ci.lower >= 0 && r.ci.upper <= 1);
    }
    if (s.kind === 'scale') {
      assert.ok(s.meanCI && s.meanCI.lower < s.mean! && s.mean! < s.meanCI.upper);
      assert.ok(s.top2CI);
    }
    if (s.kind === 'numeric') {
      assert.ok(s.meanCI && s.medianCI);
      assert.ok(s.meanCI.lower < s.mean! && s.mean! < s.meanCI.upper);
      assert.ok(s.bins.every((b) => b.ci === null), 'histogram bins carry no interval');
    }
  }
  const findings = buildFindings(ds.rows, ds.questions, stats);
  assert.ok(findings.filter((f) => !f.includes('开放回答')).every((f) => f.includes('95% 区间')));
  assert.ok(findings.some((f) => /\d+\.\d–\d+\.\d）/.test(f)), 'proportion intervals are printed as percentages');

  const scale = (values: string[]) => computeStat({ id: 'q', title: 't', rawTitle: 'q', type: 'scale', included: true }, values.map((v) => ({ q: v })));
  const few = scale(['4', '5', '3']);
  assert.ok(few.kind === 'scale' && few.n === 3);
  if (few.kind === 'scale') {
    assert.ok(few.meanCI && Math.abs(few.meanCI.lower - 1.51586228824967) < 1e-9);
    assert.ok(Math.abs(few.meanCI.upper - 6.48413771175033) < 1e-9);
  }
  assert.match(`${sampleNote(few.n)}。`, /不足 10 条，区间很宽，仅供参考。$/);
  const one = scale(['4']);
  assert.ok(one.kind === 'scale' && one.mean === 4 && one.meanCI === null);
  assert.equal(sampleNote(30), null);
  assert.match(`${sampleNote(12)}`, /不足 30 条/);
});

test('header row is detected below a title row and columns are deduplicated', () => {
  const ds = buildDataset([['大学生调查'], [], ['序号', 'Q1', 'Q1', ''], ['1', 'a', 'b', ''], ['2', 'a', '', '']], 'x.csv', 'UTF-8');
  assert.equal(ds.skippedRows, 1);
  assert.deepEqual(ds.headers, ['序号', 'Q1', 'Q1 (2)']);
  assert.equal(ds.rows.length, 2);
  assert.equal(ds.questions[0].type, 'meta');
});

test('GBK and UTF-16 files decode to readable Chinese', () => {
  const gbk = Uint8Array.from([0xc4, 0xfa, 0xba, 0xc3]);
  assert.equal(decodeText(gbk.buffer).encoding, 'GBK');
  assert.equal(decodeText(gbk.buffer).text, '您好');
  const utf8 = new TextEncoder().encode('你好');
  assert.equal(decodeText(utf8.buffer).text, '你好');
  const bom16 = new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59]);
  assert.equal(decodeText(bom16.buffer).text, '你好');
});

test('xlsx workbooks read from the first sheet as text', async () => {
  const XLSX = await import('@e965/xlsx');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['序号', '姓名'], [1, '张三'], [2, '李四']]), 'Sheet1');
  const buf = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  const grid = await parseGrid(buf, 'xlsx');
  assert.deepEqual(grid, [['序号', '姓名'], ['1', '张三'], ['2', '李四']]);
});

test('inference rules for typical survey exports', () => {
  const rep = (xs: string[]) => Array.from({ length: 30 }, (_, i) => xs[i % xs.length]);
  assert.equal(inferType('1、您的性别是', ['男', '女']), 'single');
  assert.equal(inferType('2、您使用过哪些工具（多选）', ['A', 'B']), 'multi');
  assert.equal(inferType('3、满意度', ['1', '2', '3', '4', '5']), 'scale');
  assert.equal(inferType('4、您的年龄', rep(['18', '19', '20', '21'])), 'numeric');
  assert.equal(inferType('5、您有什么建议', rep(['希望多开课', '加强指导老师培训'])), 'open');
  assert.equal(inferType('来自IP', rep(['1.2.3.4', '5.6.7.8'])), 'meta');
  assert.equal(inferType('6、其他', ['', '-']), 'single');
});
