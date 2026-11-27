import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReportHtml, reportFileName, safeFileName } from './reportFile.ts';

test('file names drop reserved characters and fall back when empty', () => {
  assert.equal(safeFileName('2026 春 / 课程: 满意度?*'), '2026 春 课程 满意度');
  assert.equal(safeFileName('  .  '), '问卷分析报告');
  assert.equal(safeFileName(''), '问卷分析报告');
  assert.equal(safeFileName('a'.repeat(120)).length, 80);
  assert.equal(reportFileName('课题<1>', 'html'), '课题1-分析报告.html');
  assert.equal(reportFileName('', 'pdf'), '问卷分析报告-分析报告.pdf');
});

test('the exported document is self-contained and script-free', () => {
  const html = buildReportHtml('<article class="page">正文 方法说明</article>', 'A & B <C>', '.page{color:red}');
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<meta charset="utf-8"/);
  assert.match(html, /<title>A &amp; B &lt;C&gt;<\/title>/);
  assert.match(html, /<style>\.page\{color:red\}/);
  assert.match(html, /@media print/);
  assert.match(html, /<article class="page">正文 方法说明<\/article>/);
  assert.ok(!html.includes('<script'), '导出文件不能带脚本');
  assert.ok(!/src="https?:/.test(html), '导出文件不能引用外部脚本');
});

test('the stylesheet argument is required so callers cannot silently drop styles', () => {
  assert.throws(() => (buildReportHtml as unknown as (...args: string[]) => string)('<p>x</p>', 't'), /stylesheet|undefined/i);
});
