export const PLACEHOLDERS = new Set(['n/a', 'na', '-', '—', '——', '未填写', '未作答', '(空)', '（空）', 'null', 'none', 'nan', 'nil', '#n/a', '#value!']);

export function isAnswer(v: string | undefined) {
  const s = (v ?? '').trim();
  return s !== '' && !PLACEHOLDERS.has(s.toLowerCase());
}

const NUMBERING = /^\s*(?:第)?\s*\d+\s*[、.．,，:：)）]\s*/;
const MARKER = /[（(]\s*第\s*\d+\s*题\s*[）)]\s*$/;
const KIND = /[（(【[]\s*(?:单选|多选|可多选|单选题|多选题|量表题|量表|填空题|填空|开放题|简答|排序题|打分题|评分题|评分|下拉框|图片单选题|图片多选题|矩阵单选题|矩阵多选题|nps)\s*[）)】]\s*/gi;

export function cleanTitle(raw: string) {
  const t = raw.trim().replace(NUMBERING, '').replace(MARKER, '').replace(KIND, '').replace(/\s+/g, ' ').trim();
  return t === '' ? raw.trim() : t;
}

export function formatPct(x: number, digits = 1) {
  return `${(x * 100).toFixed(digits)}%`;
}

export function formatNumber(x: number | null, digits = 1) {
  if (x === null || !Number.isFinite(x)) return '—';
  return x.toFixed(digits);
}

export function formatDateTime(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
