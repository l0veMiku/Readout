import type { Question } from '../types.ts';
import { numericValues } from './infer.ts';
import type { ExportProfile } from './exportProfiles.ts';

const isBinary = (v: string) => {
  const s = v.trim();
  return s === '' || s === '0' || s === '1';
};

const parseColon = (h: string) => {
  const m = /^(.+?)[:：](.+)$/.exec(h.trim());
  return m ? { stem: m[1].trim(), sub: m[2].trim() } : null;
};

const parseUnderscore = (h: string) => {
  const m = /^(.+?)_(\d+)$/.exec(h.trim());
  return m ? { stem: m[1].trim(), sub: m[2].trim() } : null;
};

// 平台/结构在题目生成前做的归一化：
// - 腾讯「题:子项」且值为 1/空 → 合并多选
// - 「题:子项」或 Q5_1 且值为数字 → 改写成可被现有题组识别的「题【子项】」
export function normalizeStructure(
  headers: string[],
  rows: Record<string, string>[],
): { headers: string[]; rows: Record<string, string>[]; notes: string[] } {
  const notes: string[] = [];
  const groups = new Map<string, { sub: string; header: string; kind: 'colon' | 'underscore' }[]>();

  for (const h of headers) {
    const c = parseColon(h);
    if (c) {
      groups.set(c.stem, [...(groups.get(c.stem) ?? []), { sub: c.sub, header: h, kind: 'colon' }]);
      continue;
    }
    const u = parseUnderscore(h);
    if (u) groups.set(u.stem, [...(groups.get(u.stem) ?? []), { sub: u.sub, header: h, kind: 'underscore' }]);
  }

  const removed = new Set<string>();
  const renamed = new Map<string, string>();
  const outRows = rows.map((r) => ({ ...r }));

  for (const [stem, members] of groups) {
    if (members.length < 2) continue;
    const binary = rows.every((r) => members.every((m) => isBinary(r[m.header] ?? '')));
    if (binary) {
      const name = `${stem}（多选）`;
      for (const r of outRows) {
        r[name] = members
          .filter((m) => (r[m.header] ?? '').trim() === '1')
          .map((m) => m.sub)
          .join('┋');
      }
      renamed.set(members[0].header, name);
      members.slice(1).forEach((m) => removed.add(m.header));
      notes.push(`合并多选列「${stem}」（${members.length} 个选项）`);
      continue;
    }
    const numeric = rows.every((r) => members.every((m) => {
      const v = (r[m.header] ?? '').trim();
      return v === '' || Number.isFinite(Number(v.replace(/,/g, '')));
    }));
    if (numeric) {
      for (const m of members) renamed.set(m.header, `${stem}【${m.sub}】`);
      notes.push(`合并矩阵题「${stem}」（${members.length} 个子项）`);
    }
  }

  if (removed.size === 0 && renamed.size === 0) return { headers, rows, notes };
  return {
    headers: headers.filter((h) => !removed.has(h)).map((h) => renamed.get(h) ?? h),
    rows: outRows,
    notes,
  };
}

const HEADER_MARK = /多选|任选|单选|量表|评分|打分|1\s*[-–—~至到]\s*\d+\s*分/;

// 给每道题附上判定来源与置信度；不改变题型本身。
export function annotateSchema(questions: Question[], rows: Record<string, string>[], profile: ExportProfile): Question[] {
  return questions.map((q) => {
    if (q.type === 'meta') {
      return {
        ...q,
        schema: {
          source: profile.id === 'generic' ? 'header' : 'platform',
          confidence: 'high',
          evidence: [profile.id === 'generic' ? '系统列名' : `${profile.label} 系统列`],
        },
      };
    }
    if (profile.id === 'qualtrics' && /^Q\d+/.test(q.rawTitle)) {
      return {
        ...q,
        schema: {
          source: 'platform',
          confidence: 'medium',
          evidence: ['Qualtrics 题号，未找到题干'],
          ...(q.type === 'single' ? { suggested: 'scale' as const } : {}),
        },
      };
    }
    if (q.type === 'scale') {
      const byHeader = HEADER_MARK.test(q.rawTitle);
      return {
        ...q,
        schema: {
          source: byHeader ? 'header' : 'structure',
          confidence: byHeader ? 'high' : 'medium',
          evidence: [byHeader ? '表头写明量表/评分' : q.groupId ? '同一题组的整数题' : '同域整数题成组'],
        },
      };
    }
    if (q.type === 'single' || q.type === 'numeric') {
      const values = rows.map((r) => r[q.id] ?? '').filter((v) => v !== '');
      const nums = numericValues(values);
      const allNumeric = nums.length === values.length && values.length > 0;
      const distinct = new Set(nums);
      if (allNumeric && distinct.size >= 3 && Math.min(...nums) >= 1 && Math.max(...nums) <= 5) {
        return {
          ...q,
          schema: {
            source: 'value',
            confidence: 'low',
            evidence: ['单列 1–5 整数，无法区分单选与量表'],
            suggested: 'scale',
          },
        };
      }
      return { ...q, schema: { source: 'value', confidence: 'high', evidence: ['取值形态明确'] } };
    }
    if (q.type === 'multi') {
      const merged = /（多选）|（多选）$/.test(q.rawTitle);
      return {
        ...q,
        schema: { source: merged ? 'structure' : 'header', confidence: merged ? 'high' : 'medium', evidence: [merged ? '选项列合并' : '表头/取值判断为多选'] },
      };
    }
    if (q.type === 'open') {
      return { ...q, schema: { source: 'value', confidence: 'high', evidence: ['长文本回答'] } };
    }
    if (/ \(\d+\)$/.test(q.rawTitle)) {
      return { ...q, schema: { source: 'structure', confidence: 'medium', evidence: ['重复表头/分支列'] } };
    }
    return q;
  });
}


// 用户手动改题型：记录来源，后续自动推断不得覆盖。
export function withUserSchema(q: Question, type: Question['type']): Question {
  return {
    ...q,
    type,
    included: type === 'meta' ? false : q.type === 'meta' ? true : q.included,
    schema: { source: 'user', confidence: 'high', evidence: ['用户手动修改'], confirmed: true },
  };
}
