import { escapeHtml } from './text.ts';

const FALLBACK_TITLE = '问卷分析报告';
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

// 报告页的额外排版：离线打开时居中、留出页边；打印时回到 A4 版心。
const PAGE_CSS = `
body { margin: 0; padding: 24px 16px 48px; background: var(--paper); }
body > .page { margin: 0 auto; }
@media print {
  body { padding: 0; background: #fff; }
}
`;

// 标题里的路径/保留字符去掉，空标题回退；两边都去掉空白与点号，避免 Windows 上无法保存。
export function safeFileName(title: string) {
  const cleaned = title
    .replace(ILLEGAL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80)
    .trim();
  return cleaned || FALLBACK_TITLE;
}

export function reportFileName(title: string, ext: 'html' | 'pdf') {
  return `${safeFileName(title)}-分析报告.${ext}`;
}

// 把报告 DOM 包成自包含的 HTML：内联整份样式表与图表 SVG，不带脚本，不引用外部资源。
export function buildReportHtml(body: string, title: string, stylesheet: string) {
  if (!stylesheet) throw new Error('buildReportHtml: stylesheet is required for a self-contained export');
  const safeTitle = escapeHtml(title.trim() || FALLBACK_TITLE);
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${safeTitle}</title>`,
    `<style>${stylesheet}${PAGE_CSS}</style>`,
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function downloadText(fileName: string, text: string, type = 'text/html;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
