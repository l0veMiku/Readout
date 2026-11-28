import type { DatasetFormat } from '../types.ts';

export type ProfileId = 'wjx' | 'tencent' | 'qualtrics' | 'google-forms' | 'generic';

export interface ExportProfile {
  id: ProfileId;
  label: string;
  // 命中权重：同一条证据只加一次。
  detect(headers: string[]): number;
  missingTokens: string[];
  systemColumns: RegExp[];
}

const has = (headers: string[], text: string) => headers.some((h) => h.trim() === text);
const hasPrefix = (headers: string[], text: string) => headers.some((h) => h.trim().startsWith(text));

const WJX: ExportProfile = {
  id: 'wjx',
  label: '问卷星',
  missingTokens: [''],
  systemColumns: [/^序号$/, /^提交答卷时间$/, /^所用时间$/, /^来源(?:详情)?$/, /^来自IP$/],
  detect: (headers) => {
    let score = 0;
    if (has(headers, '提交答卷时间')) score += 3;
    if (has(headers, '所用时间')) score += 2;
    if (has(headers, '来源详情')) score += 2;
    if (has(headers, '来自IP')) score += 2;
    if (has(headers, '序号')) score += 1;
    return score;
  },
};

const TENCENT: ExportProfile = {
  id: 'tencent',
  label: '腾讯问卷',
  missingTokens: ['', 'N/A'],
  systemColumns: [/^编号$/, /^开始答题时间$/, /^结束答题时间$/, /^答题时长$/, /^地理位置/, /^自定义字段$/],
  detect: (headers) => {
    let score = 0;
    if (has(headers, '编号')) score += 2;
    if (has(headers, '开始答题时间')) score += 3;
    if (has(headers, '结束答题时间')) score += 2;
    if (has(headers, '答题时长')) score += 2;
    if (hasPrefix(headers, '地理位置')) score += 2;
    return score;
  },
};

const QUALTRICS: ExportProfile = {
  id: 'qualtrics',
  label: 'Qualtrics',
  missingTokens: ['', 'NA', 'N/A', 'null', 'NULL'],
  systemColumns: [/^ResponseID$/, /^ResponseSet$/, /^StartDate$/, /^EndDate$/, /^Finished$/, /^Status$/, /^IPAddress$/, /^Recipient/],
  detect: (headers) => {
    let score = 0;
    if (has(headers, 'ResponseID')) score += 3;
    if (has(headers, 'ResponseSet')) score += 2;
    if (has(headers, 'StartDate')) score += 2;
    if (has(headers, 'EndDate')) score += 1;
    if (has(headers, 'Finished')) score += 2;
    if (has(headers, 'Status')) score += 1;
    return score;
  },
};

const GOOGLE_FORMS: ExportProfile = {
  id: 'google-forms',
  label: 'Google Forms',
  missingTokens: [''],
  systemColumns: [/^Timestamp$/],
  detect: (headers) => {
    if (headers[0]?.trim() !== 'Timestamp') return 0;
    // Google Forms 没有系统 ID；带 ResponseID 的更可能是别家。
    if (headers.some((h) => /^ResponseID$/i.test(h.trim()))) return 0;
    return 4;
  },
};

const GENERIC: ExportProfile = {
  id: 'generic',
  label: '通用',
  missingTokens: [''],
  systemColumns: [],
  detect: () => 0,
};

export const EXPORT_PROFILES: ExportProfile[] = [WJX, TENCENT, QUALTRICS, GOOGLE_FORMS, GENERIC];

// 低于这个分数就不启用平台规则，避免单列「编号」误触发。
const MIN_SCORE = 4;

export function detectProfile(headers: string[]): ExportProfile {
  let best: ExportProfile = GENERIC;
  let bestScore = 0;
  for (const profile of EXPORT_PROFILES) {
    const score = profile.detect(headers);
    if (score > bestScore) {
      best = profile;
      bestScore = score;
    }
  }
  return bestScore >= MIN_SCORE ? best : GENERIC;
}

export function formatOf(profile: ExportProfile, notes: string[] = []): DatasetFormat {
  return { id: profile.id, label: profile.label, missingTokens: profile.missingTokens, notes };
}

// 缺失码只做整格匹配，避免把 0.5 或 90 误当缺失。
export function normalizeMissing(rows: Record<string, string>[], tokens: string[]): { rows: Record<string, string>[]; touched: number } {
  const set = new Set(tokens.map((t) => t.trim()).filter(Boolean));
  if (set.size === 0) return { rows, touched: 0 };
  let touched = 0;
  const out = rows.map((row) => {
    let changed = false;
    const next = { ...row };
    for (const key of Object.keys(next)) {
      if (set.has((next[key] ?? '').trim())) {
        next[key] = '';
        changed = true;
      }
    }
    if (changed) touched++;
    return next;
  });
  return { rows: out, touched };
}
