import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AIError, buildMessages, parseThemes, sampleAnswers } from './ai.ts';

const answers = ['希望学校提供正版 AI 工具', 'Response is fine', '  多开一些   入门讲座  ', ''];

test('parseThemes 保留逐字引文、丢弃编造的引文', () => {
  const text = '```json\n' + JSON.stringify({
    summary: '  整体偏正面。  ',
    themes: [
      { name: '工具与资源', description: '希望有正版工具', sentiment: 'positive', count: 12.4, quotes: ['正版 AI 工具', '学校没有提供任何工具', '希望学校提供正版 AI 工具'] },
      { name: '', sentiment: 'negative', count: 3, quotes: [] },
      { name: '入门指导', sentiment: 'angry', count: -5, quotes: ['多开一些 入门讲座'] },
      { name: '英文回答', count: 999, quotes: ['response IS fine'] },
    ],
  }) + '\n```';
  const { summary, themes } = parseThemes(text, answers);
  assert.equal(summary, '整体偏正面。');
  assert.deepEqual(themes, [
    { name: '工具与资源', description: '希望有正版工具', sentiment: 'positive', count: 4, quotes: ['正版 AI 工具', '希望学校提供正版 AI 工具'] },
    { name: '入门指导', description: '', sentiment: 'neutral', count: 0, quotes: ['多开一些 入门讲座'] },
    { name: '英文回答', description: '', sentiment: 'neutral', count: 4, quotes: [] },
  ]);
});

test('parseThemes 在没有 JSON 或没有主题时报错', () => {
  assert.throws(() => parseThemes('抱歉，我无法完成。', answers), AIError);
  assert.throws(() => parseThemes('{"summary": "x", "themes": []}', answers), AIError);
});

test('sampleAnswers 超过 240 条时等距抽样', () => {
  const many = Array.from({ length: 1000 }, (_, i) => `回答 ${i}`);
  const full = sampleAnswers(answers);
  assert.equal(full.sampled, false);
  assert.equal(full.sample.length, 4);
  const part = sampleAnswers(many);
  assert.equal(part.sampled, true);
  assert.equal(part.sample.length, 240);
  assert.equal(part.sample[0], '回答 0');
  assert.equal(new Set(part.sample).size, 240);
});

test('buildMessages 给回答编号并截断过长内容', () => {
  const long = '长'.repeat(400);
  const messages = buildMessages('你有什么建议？', [long, '短回答']);
  assert.ok(messages[1].content.startsWith('题目：你有什么建议？\n\n共 2 条回答：\n1. '));
  assert.equal(messages[1].content.includes('长'.repeat(181)), false);
  assert.ok(messages[1].content.endsWith('\n2. 短回答'));
});
