import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Question, QuestionType } from '../types.ts';
import { inferQuestions, inferType, splitMultiDetailed } from './infer.ts';
import { buildDataset, decodeText, parseGrid, parseWorkbook } from './parse.ts';
import { buildFindings, computeStat, numericSamples, sampleNote, withBootstrap } from './stats.ts';
import { bootstrapIntervals } from './intervals.ts';
import { includedItems, mergeQuestions, splitGroup, toggleIncluded } from './groups.ts';
import { durationInfo, evaluateCleaning, newRule } from './cleaning.ts';
import { reliability } from './reliability.ts';

function demoDataset() {
  const text: string = readFileSync(new URL('../../public/demo-survey.csv', import.meta.url), 'utf8');
  const grid = text.replace(/^\ufeff/, '').split(/\r?\n/).filter((l) => l !== '').map((l) => l.split(','));
  return buildDataset(grid, 'demo-survey.csv', 'UTF-8');
}

test('demo survey: every question type is inferred as designed', () => {
  const ds = demoDataset();
  assert.equal(ds.rows.length, 128);
  assert.deepEqual(ds.questions.map((q) => q.type), [
    'meta', 'meta', 'meta', 'single', 'single', 'single', 'single', 'multi', 'multi',
    'scale', 'scale', 'numeric', 'numeric', 'open', 'multi', 'open',
    'scale', 'scale', 'scale',
  ]);
  assert.equal(ds.questions[3].title, '您的年级是？');
  assert.equal(ds.questions[7].title, '您使用过哪些 AI 工具？');
  assert.equal(ds.questions.filter((q) => q.included).length, 16);
  assert.equal(ds.groups.length, 1);
  assert.equal(ds.groups[0].title, '第14题');
  assert.equal(ds.questions.filter((q) => q.groupId).length, 3);
});

test('demo data shows a usable reliability and a few careless responses', () => {
  const ds = demoDataset();
  const r = reliability(ds.questions.filter((q) => q.groupId), ds.rows)!;
  assert.ok(r.alpha !== null && r.alpha > 0.7 && r.alpha < 0.9, `demo alpha ${r.alpha}`);
  assert.ok(r.items.every((it) => it.citc !== null && it.citc > 0.3), 'no item correlates negatively with the rest');
  assert.equal(durationInfo(ds)!.unreadable, 0);
  const fast = { ...newRule('duration'), maxSeconds: 60 };
  const hits = evaluateCleaning({ ...ds, cleaning: { rules: [fast], includeFlagged: true, overrides: {} } }).counts[fast.id];
  assert.ok(hits >= 4 && hits <= 12, `${hits} responses under a minute`);
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

  const neg = computeStat(mk('numeric'), rowsOf(['-5', '-4', '-1', '0', '2']));
  if (neg.kind !== 'numeric') return;
  assert.deepEqual(neg.bins.map((b) => b.name), ['-5 至 -4', '-4 至 -3', '-3 至 -2', '-2 至 -1', '-1 至 0', '0–1', '1–2']);

  // 极端值单独归到两端，不把 0–100000 拉成十段。
  const values = Array.from({ length: 50 }, (_, i) => String(i + 1));
  const outlier = computeStat(mk('numeric'), rowsOf([...values, '100000']), { shape: true });
  if (outlier.kind !== 'numeric') return;
  assert.equal(outlier.bins.reduce((s, b) => s + b.count, 0), 51);
  assert.ok(outlier.bins[outlier.bins.length - 1].name.startsWith('≥'), '高处极端值有独立分箱');
  assert.ok(!outlier.bins.some((b) => b.name.includes('100000')));
  assert.equal(outlier.shape?.outliers?.n, 1);
  assert.equal(outlier.shape?.outliers?.max, 100000);

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
  const topTool = computeStat(ds.questions[7], ds.rows);
  if (topTool.kind === 'multi') {
    const text = findings.find((f) => f.includes(ds.questions[7].title));
    assert.ok(text?.includes(`「${topTool.options[0].name}」`));
  }
  const least = computeStat(ds.questions[3], ds.rows);
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

test('numeric stats ship without intervals first and equal the synchronous result once the background job lands', () => {
  const q: Question = { id: 'q', title: 't', rawTitle: 'q', type: 'numeric', included: true };
  const rows = [...Array.from({ length: 60 }, (_, i) => ({ q: String(((i * 37) % 23) / 4) })), { q: '' }];
  const sync = computeStat(q, rows);
  const first = computeStat(q, rows, { deferBootstrap: true });
  assert.ok(sync.kind === 'numeric' && first.kind === 'numeric');
  if (sync.kind !== 'numeric' || first.kind !== 'numeric') return;
  assert.equal(first.ciPending, true);
  assert.equal(first.meanCI, null);
  assert.equal(first.medianCI, null);
  assert.equal(first.mean, sync.mean);
  assert.deepEqual(first.bins, sync.bins);

  const done = withBootstrap(first, bootstrapIntervals(numericSamples(q, rows)));
  assert.deepEqual(done, sync);
  assert.equal('ciPending' in done, false);
  // 已有区间的结果不会被再次合并改写；有效回答不足 2 条时补上后仍然没有区间。
  assert.equal(withBootstrap(done, { mean: null, median: null }), done);
  const single = computeStat(q, [{ q: '3' }]);
  assert.deepEqual(withBootstrap(computeStat(q, [{ q: '3' }], { deferBootstrap: true }), bootstrapIntervals([3])), single);
});

test('header row is detected below a title row and columns are deduplicated', () => {
  const ds = buildDataset([['大学生调查'], [], ['序号', 'Q1', 'Q1', ''], ['1', 'a', 'b', ''], ['2', 'a', '', '']], 'x.csv', 'UTF-8');
  assert.equal(ds.skippedRows, 1);
  assert.deepEqual(ds.headers, ['序号', 'Q1', 'Q1 (2)']);
  assert.equal(ds.rows.length, 2);
  assert.equal(ds.questions[0].type, 'meta');
});

test('GBK, Big5, GB18030 and UTF-16 files decode to readable text', () => {
  const gbk = Uint8Array.from([0xc4, 0xfa, 0xba, 0xc3]);
  assert.equal(decodeText(gbk.buffer).encoding, 'GBK');
  assert.equal(decodeText(gbk.buffer).text, '您好');
  const utf8 = new TextEncoder().encode('你好');
  assert.equal(decodeText(utf8.buffer).text, '你好');
  const bom16 = new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59]);
  assert.equal(decodeText(bom16.buffer).text, '你好');

  const big5 = Uint8Array.from([169, 109, 166, 87, 44, 171, 176, 165, 171, 44, 186, 161, 183, 78, 171, 215, 10, 177, 105, 164, 84, 44, 165, 120, 165, 95, 44, 171, 68, 177, 96, 186, 161, 183, 78, 10, 167, 245, 165, 124, 44, 176, 170, 182, 175, 44, 164, 241, 184, 251, 186, 161, 183, 78, 10]);
  const t = decodeText(big5.buffer);
  assert.equal(t.encoding, 'Big5');
  assert.ok(t.text.startsWith('姓名,城市,滿意度'));

  const gb18030 = Uint8Array.from([149, 50, 130, 54]);
  assert.equal(decodeText(gb18030.buffer).encoding, 'GB18030');
  assert.equal(decodeText(gb18030.buffer).text, '𠀀');
});

test('legacy Western files are not forced through GBK', () => {
  const latin = Uint8Array.from([80, 114, 233, 110, 111, 109, 44, 86, 105, 108, 108, 101, 44, 83, 97, 116, 105, 115, 102, 97, 99, 116, 105, 111, 110, 10, 82, 101, 110, 233, 44, 71, 101, 110, 232, 118, 101, 44, 84, 114, 232, 115, 32, 115, 97, 116, 105, 115, 102, 97, 105, 116, 10, 65, 110, 97, 44, 76, 105, 115, 98, 111, 97, 44, 83, 97, 116, 105, 115, 102, 97, 105, 116, 10]);
  const r = decodeText(latin.buffer);
  assert.equal(r.encoding, 'Windows-1252');
  assert.ok(r.text.includes('Prénom'));
});

test('a stray bad byte does not drag a UTF-8 file into GBK', () => {
  const clean = new TextEncoder().encode('姓名,城市,满意度\n张三,北京,非常满意\n李四,上海,比较满意\n王五,广州,不满意\n');
  const broken = new Uint8Array(clean.length + 1);
  broken.set(clean);
  broken[clean.length] = 0x80;
  const r = decodeText(broken.buffer);
  assert.equal(r.encoding, 'UTF-8');
  assert.ok(r.text.includes('非常满意'));
  assert.equal((r.text.match(/\uFFFD/g) ?? []).length, 1);
});

test('xlsx workbooks read the data sheet, not a leading instructions sheet', async () => {
  const XLSX = await import('@e965/xlsx');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['填写说明'], ['请按实际情况作答']]), '说明');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['序号', '姓名'], [1, '张三'], [2, '李四']]), '数据');
  const buf = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  const { grid, sheet } = await parseWorkbook(buf);
  assert.equal(sheet, '数据');
  assert.deepEqual(grid, [['序号', '姓名'], ['1', '张三'], ['2', '李四']]);
  assert.deepEqual(await parseGrid(buf, 'xlsx'), grid);
  assert.equal(buildDataset(grid, 'x.xlsx', 'Excel', sheet).sheet, '数据');
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
  // 短开放回答：题干像开放题、每条都不同，不能因为取值少就当单选。
  assert.equal(inferType('您希望 AI 改进什么', ['更准确', '少一点套话', '速度', '引用要准']), 'open');
  assert.equal(inferType('您对课程的建议', ['多讲案例', '作业少一点', '节奏慢一点']), 'open');
  // 名义型单选即使题干有「什么/哪些」也不误判。
  assert.equal(inferType('您通常使用什么品牌的手机', ['华为', '小米', '苹果', 'OPPO']), 'single');
});

test('numeric 1-5 batteries become a scale, lone coded columns stay single', () => {
  const rows = Array.from({ length: 12 }, (_, i) => {
    const v = String((i % 4) + 1);
    return {
      Q1: v,
      Q2: String(((i + 1) % 4) + 1),
      Q3: String(((i + 2) % 4) + 1),
      Q4: String(((i + 3) % 4) + 1),
      grade: String((i % 4) + 1),
      '第5题（单选）': String((i % 4) + 1),
    };
  });
  const { questions } = inferQuestions(['Q1', 'Q2', 'Q3', 'Q4', 'grade', '第5题（单选）'], rows);
  assert.deepEqual(questions.slice(0, 4).map((q) => q.type), ['scale', 'scale', 'scale', 'scale']);
  assert.equal(questions[4].type, 'single', '单列 1-4 仍按编码单选');
  assert.equal(questions[5].type, 'single', '显式单选不提升');

  const onlyTwo = inferQuestions(['Q1', 'Q2'], rows).questions;
  assert.deepEqual(onlyTwo.map((q) => q.type), ['single', 'single'], '不足三列不成组');

  // 缺少端点不影响成组：有的题没人选 1，有的没人选 5，仍是同一套 1–5 量表。
  const skewed = Array.from({ length: 12 }, (_, i) => ({ A: String((i % 4) + 1), B: String((i % 4) + 2), C: String((i % 5) + 1), D: String((i % 3) + 2) }));
  const family = inferQuestions(['A', 'B', 'C', 'D'], skewed).questions;
  assert.deepEqual(family.map((q) => q.type), ['scale', 'scale', 'scale', 'scale']);
});

test('explicit type markers beat keyword heuristics, and open text keeps its semicolons', () => {
  const rep = (xs: string[]) => Array.from({ length: 30 }, (_, i) => xs[i % xs.length]);
  const options = ['微信公众号平台', '朋友或同事推荐', '搜索引擎广告', '短视频平台', '线下推广活动'];
  assert.equal(inferType('您通过哪些渠道了解本产品？（单选）', rep(options)), 'single');
  assert.equal(
    inferType('您对课程有什么建议？', rep(['挺好的；希望多一些实践', '没有；暂时想不到', '建议增加答疑；作业讲评', '课程节奏合适；老师讲得清楚', '希望有更多案例；多些练习'])),
    'open',
  );
  assert.equal(inferType('请说明您选择这些工具的原因', rep(['写代码；查资料', '写代码；写文档', '查资料；做汇报'])), 'open');
  assert.equal(inferType('您选修了哪些课程？', rep(['高数；线代', '线代；概率论', '高数；概率论'])), 'multi');
});

test('a Likert scale stays a scale when the platform marks the header as single choice', () => {
  const rep = (xs: string[]) => Array.from({ length: 30 }, (_, i) => xs[i % xs.length]);
  const satisfaction = ['非常满意', '满意', '一般', '不满意', '非常满意'];
  assert.equal(inferType('您对本课程的满意度（单选）', rep(satisfaction)), 'scale');
  assert.equal(inferType('您是否同意以下说法（单选）', rep(['非常同意', '同意', '一般', '不同意', '非常同意'])), 'scale');
  assert.equal(inferType('您对食堂的满意度【单选题】', rep(satisfaction)), 'scale');
  assert.equal(inferType('3、性别（单选）', rep(['1', '2'])), 'single');
});

test('bare channel, city, region and total-score headers are real questions, not metadata', () => {
  const rep = (xs: string[]) => Array.from({ length: 30 }, (_, i) => xs[i % xs.length]);
  assert.equal(inferType('渠道', rep(['微信', '朋友推荐', '搜索引擎'])), 'single');
  assert.equal(inferType('城市', rep(['北京', '上海', '合肥'])), 'single');
  assert.equal(inferType('地区', rep(['华东', '华北', '华南'])), 'single');
  assert.equal(inferType('总分', rep(['85', '90', '78', '100'])), 'numeric');
});

test('platform system columns from Tencent and Wenjuanxing exports are metadata', () => {
  const ds = buildDataset(
    [
      ['编号', '开始答题时间', '结束答题时间', '答题时长', '语言', '清洗数据结果', '智能清洗数据无效概率', '地理位置省', '地理位置市', '自定义字段', '1.老师所属校区是？'],
      ['1', '21-Mar-2024 14:01:08', '21-Mar-2024 14:05:37', '269', '', '未清洗', '', '山东省', '济宁市', '', 'A.曲阜'],
      ['2', '21-Mar-2024 15:01:08', '21-Mar-2024 15:05:37', '269', '', '未清洗', '', '山东省', '日照市', '', 'B.日照'],
    ],
    'tencent.csv',
    'UTF-8',
  );
  assert.ok(ds.questions.slice(0, 10).every((q) => q.type === 'meta'), 'system columns are ignored');
  assert.equal(ds.questions[10].type, 'single');
});

test('1-10 integer codes are single choice unless the title marks a scale', () => {
  const rep = (xs: string[]) => Array.from({ length: 60 }, (_, i) => xs[i % xs.length]);
  assert.equal(inferType('1、手机部数', rep(['1', '2', '3', '4'])), 'single');
  assert.equal(inferType('2、手机价格', rep(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])), 'single');
  assert.equal(inferType('3、性别', rep(['1', '2'])), 'single');
  assert.equal(inferType('4、年龄', rep(['1', '2', '3', '4', '5', '6', '7', '8', '9'])), 'single');
  assert.equal(inferType('7.打分', rep(['1', '2', '3', '4', '5', '6', '7'])), 'scale');
  assert.equal(inferType('5、满意度（1–5 分）', rep(['1', '2', '3', '4', '5'])), 'scale');
  assert.equal(inferType('8.量表题', rep(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])), 'scale');
});

test('text Likert labels are scored in order and keep their wording', () => {
  const values = ['非常不符合', '不太符合', '一般', '比较符合', '非常符合', '非常不符合', '不太符合', '一般', '比较符合', '非常符合'];
  assert.equal(inferType('11、轻食食材健康性是我选择的核心考量', values), 'scale');
  const q: Question = { id: 'q', title: 't', rawTitle: 't', type: 'scale', included: true };
  const s = computeStat(q, values.map((v) => ({ q: v })));
  assert.equal(s.kind, 'scale');
  if (s.kind !== 'scale') return;
  assert.deepEqual(s.levels.map((l) => l.name), ['非常不符合', '不太符合', '一般', '比较符合', '非常符合']);
  assert.equal(s.numeric, false);
  assert.equal(s.mean, 3);
  assert.equal(s.top2, 0.4);
  assert.ok(s.meanCI);
});

test('a few long option labels stay single choice instead of open text', () => {
  const city = ['珠三角核心城市（广州、深圳、佛山、东莞）', '粤东地区（汕头、潮州、揭阳、汕尾）', '粤西地区（湛江、茂名、阳江、云浮）'];
  const values = Array.from({ length: 30 }, (_, i) => city[i % city.length]);
  assert.equal(inferType('3、你所在的广东省城市', values), 'single');
});

test('0/1 option columns are merged back into one multi-select question', () => {
  const ds = buildDataset(
    [
      ['序号', '第6题(运动)', '第6题(阅读)', '第6题(其他【请注明】)', '第6题(音乐)'],
      ['1', '1', '0', '0', '1'],
      ['2', '0', '1', '1', '0'],
      ['3', '1', '1', '0', '0'],
    ],
    'wjx.xls',
    'Excel',
  );
  assert.deepEqual(ds.headers, ['序号', '第6题（多选）']);
  assert.equal(ds.questions[1].title, '第6题');
  assert.equal(ds.questions[1].type, 'multi');
  const s = computeStat(ds.questions[1], ds.rows);
  assert.equal(s.kind, 'multi');
  if (s.kind !== 'multi') return;
  assert.equal(s.n, 3);
  assert.equal(s.avgSelected, 2);
  assert.deepEqual(Object.fromEntries(s.options.map((o) => [o.name, o.count])), { 运动: 2, 阅读: 2, '其他【请注明】': 1, 音乐: 1 });
});

test('multi-select "other" notes count as one option and keep the text', () => {
  assert.deepEqual(splitMultiDetailed('其他〖好吃〗'), [{ name: '其他', note: '好吃' }]);
  const q: Question = { id: 'q', title: 't', rawTitle: 't', type: 'multi', included: true };
  const s = computeStat(q, ['运动┋其他〖好吃〗', '其他〖宠物〗'].map((v) => ({ q: v })));
  assert.equal(s.kind, 'multi');
  if (s.kind !== 'multi') return;
  const other = s.options.find((o) => o.name === '其他');
  assert.equal(other?.count, 2);
  assert.deepEqual(other?.notes, ['好吃', '宠物']);
});

test('shared-stem columns form a question group with sub-items', () => {
  const ds = buildDataset(
    [
      ['序号', '第12题(环境)', '第12题(服务)'],
      ['1', '5', '4'],
      ['2', '3', '2'],
      ['3', '4', '5'],
    ],
    'wjx.xls',
    'Excel',
  );
  assert.equal(ds.groups.length, 1);
  assert.equal(ds.groups[0].title, '第12题');
  assert.equal(ds.questions[1].groupId, ds.groups[0].id);
  assert.equal(ds.questions[1].title, '第12题 · 环境');
  assert.equal(ds.questions[1].type, 'scale');
  const items = includedItems(ds);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'group');
  if (items[0].kind === 'group') assert.equal(items[0].questions.length, 2);
});

test('questions can be merged, ignored as a group and split again', () => {
  const ds = buildDataset(
    [
      ['Q1', 'Q2', 'Q3'],
      ['a', 'b', 'c'],
      ['b', 'c', 'a'],
    ],
    'x.csv',
    'UTF-8',
  );
  const merged = mergeQuestions(ds, [ds.questions[0].id, ds.questions[1].id], '两题');
  assert.equal(merged.groups.length, 1);
  assert.equal(merged.groups[0].title, '两题');
  assert.ok(merged.questions[0].groupId);
  assert.equal(includedItems(merged).length, 2);

  const ignored = toggleIncluded(merged, merged.questions[0].id);
  assert.ok(ignored.questions.filter((q) => q.groupId).every((q) => !q.included));

  const split = splitGroup(merged, merged.groups[0].id);
  assert.equal(split.groups.length, 0);
  assert.equal(split.questions[0].groupId, undefined);
  assert.equal(split.questions[0].subTitle, undefined);
  assert.equal(split.questions[0].title, 'Q1');
  assert.equal(includedItems(split).length, 3);

  const auto = buildDataset(
    [
      ['第12题(环境)', '第12题(服务)'],
      ['5', '4'],
      ['3', '2'],
    ],
    'wjx.xls',
    'Excel',
  );
  const autoSplit = splitGroup(auto, auto.groups[0].id);
  assert.equal(autoSplit.questions[0].title, '第12题 · 环境');

  const withMeta = buildDataset([['序号', 'Q1'], ['1', 'a'], ['2', 'b']], 'x.csv', 'UTF-8');
  assert.equal(withMeta.questions[0].type, 'meta');
  const restored = toggleIncluded(withMeta, withMeta.questions[0].id);
  assert.equal(restored.questions[0].included, true);
  assert.equal(restored.questions[0].type, 'single');
});
