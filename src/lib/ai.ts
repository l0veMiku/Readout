import type { AIConfig, AIResult, Sentiment, Theme } from '../types.ts';

export interface Preset {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
}

export const PRESETS: Preset[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.7-plus' },
  { id: 'kimi', name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3' },
  { id: 'custom', name: '自定义', baseUrl: '', model: '' },
];

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  positive: '正面',
  neutral: '中性',
  negative: '负面',
  mixed: '褒贬不一',
};

const MAX_ANSWERS = 240;
const MAX_CHARS = 180;
const TIMEOUT_MS = 60000;

export class AIError extends Error {}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[“”"']/g, '');

function clip(s: unknown, max: number) {
  return typeof s === 'string' ? s.trim().slice(0, max) : '';
}

export function sampleAnswers(valid: string[]) {
  if (valid.length <= MAX_ANSWERS) return { sample: valid, sampled: false };
  const sample: string[] = [];
  for (let i = 0; i < MAX_ANSWERS; i++) sample.push(valid[Math.floor((i * valid.length) / MAX_ANSWERS)]);
  return { sample, sampled: true };
}

export function buildMessages(title: string, answers: string[]) {
  const numbered = answers.map((a, i) => `${i + 1}. ${a.slice(0, MAX_CHARS)}`).join('\n');
  return [
    {
      role: 'system' as const,
      content:
        '你是问卷开放题的编码员。任务是把受访者对同一道题的回答归纳成 3–6 个主题。\n' +
        '要求：\n' +
        '1. 只根据给出的回答下结论，不要补充回答里没有的信息。\n' +
        '2. quotes 必须是回答中逐字出现的片段，每条不超过 60 字，不要改写。\n' +
        '3. count 是你估计的属于该主题的回答条数（一条回答可以属于多个主题）。\n' +
        '4. 只输出 JSON，不要输出 Markdown 代码块或任何解释。\n' +
        '输出格式：{"summary": "一句话概括整体倾向", "themes": [{"name": "主题名（不超过 8 个字）", "description": "一句话解释", "sentiment": "positive|neutral|negative|mixed", "count": 0, "quotes": ["原文片段"]}]}',
    },
    { role: 'user' as const, content: `题目：${title}\n\n共 ${answers.length} 条回答：\n${numbered}` },
  ];
}

export function parseThemes(text: string, answers: string[]): Pick<AIResult, 'summary' | 'themes'> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new AIError('模型没有返回可解析的 JSON，请重试。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AIError('模型返回的 JSON 格式有误，请重试。');
  }
  const root = parsed as { summary?: unknown; themes?: unknown } | null;
  const rawThemes = Array.isArray(root?.themes) ? (root.themes as unknown[]) : [];
  const pool = answers.map(normalize);
  const isVerbatim = (q: string) => pool.some((a) => a.includes(normalize(q)));
  const themes: Theme[] = [];
  for (const raw of rawThemes) {
    const t = raw as Record<string, unknown> | null;
    const name = clip(t?.name, 30);
    if (!name) continue;
    const quotes = (Array.isArray(t?.quotes) ? t.quotes : [])
      .map((q) => clip(q, MAX_CHARS))
      .filter((q) => q && isVerbatim(q))
      .slice(0, 5);
    const count = typeof t?.count === 'number' && Number.isFinite(t.count) ? Math.max(0, Math.min(Math.round(t.count), answers.length)) : 0;
    const sentiment = t?.sentiment;
    themes.push({
      name,
      description: clip(t?.description, 200),
      sentiment: sentiment === 'positive' || sentiment === 'negative' || sentiment === 'mixed' ? sentiment : 'neutral',
      count,
      quotes,
    });
  }
  if (themes.length === 0) throw new AIError('模型没有归纳出任何主题，请重试。');
  return { summary: clip(root?.summary, 300), themes: themes.slice(0, 8) };
}

export function describeHttpError(status: number, baseUrl: string) {
  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
    }
  })();
  if (status === 401 || status === 403) return 'API Key 无效或没有权限，请检查后重试。';
  if (status === 404) return `接口地址或模型名不对（${host} 返回 404）。请核对 Base URL 和模型名。`;
  if (status === 429) return '请求过于频繁或额度不足（429），请稍后重试。';
  if (status >= 500) return `模型服务商暂时不可用（${status}），请稍后重试。`;
  return `请求失败（HTTP ${status}），请检查接口配置。`;
}

async function chat(config: AIConfig, messages: { role: 'system' | 'user'; content: string }[], maxTokens: number) {
  if (!config.apiKey.trim()) throw new AIError('还没有填写 API Key。');
  let url: URL;
  try {
    url = new URL(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`);
  } catch {
    throw new AIError('Base URL 格式不对，应当形如 https://api.deepseek.com。');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey.trim()}` },
      body: JSON.stringify({ model: config.model.trim(), messages, temperature: 0.2, max_tokens: maxTokens }),
      signal: controller.signal,
    });
    if (!res.ok) throw new AIError(describeHttpError(res.status, config.baseUrl));
    const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (controller.signal.aborted) throw new AIError('请求超过 60 秒没有返回，请检查网络或稍后重试。');
    throw new AIError(`无法连接到 ${url.host}。可能是网络问题，也可能是该服务商不允许浏览器直接访问（CORS）。`);
  } finally {
    clearTimeout(timer);
  }
}

export async function testConnection(config: AIConfig) {
  const reply = await chat(config, [{ role: 'user', content: '只回复两个字母：ok' }], 8);
  return reply.trim().slice(0, 40);
}

export async function summarizeOpenQuestion(config: AIConfig, title: string, valid: string[]): Promise<AIResult> {
  if (valid.length === 0) throw new AIError('这道题还没有有效回答。');
  const { sample, sampled } = sampleAnswers(valid);
  const text = await chat(config, buildMessages(title, sample), 2000);
  const { summary, themes } = parseThemes(text, sample);
  return {
    summary,
    themes,
    total: valid.length,
    analyzed: sample.length,
    sampled,
    model: config.model.trim(),
    createdAt: new Date().toISOString(),
  };
}
