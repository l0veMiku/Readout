import Papa from 'papaparse';
import type { Dataset } from '../types.ts';
import { inferQuestions } from './infer.ts';

export class ParseError extends Error {}

const MAX_ROWS = 20000;

export const SUPPORTED_EXTENSIONS = ['csv', 'xlsx', 'xls'];

export function fileExtension(name: string) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

export function decodeText(buf: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16' };
  if (bytes[1] === 0 && bytes[0] !== 0) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'UTF-16' };
  if (bytes[0] === 0 && bytes[1] !== 0) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'UTF-16' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('gbk').decode(bytes), encoding: 'GBK' };
  }
}

export function parseCsv(text: string): string[][] {
  const result = Papa.parse<string[]>(text, { header: false, skipEmptyLines: 'greedy' });
  // 列数不一致只影响个别行，交给后续处理；引号不闭合、分隔符识别失败才是硬错误。
  const fatal = result.errors.find((e) => e.code !== 'TooFewFields' && e.code !== 'TooManyFields');
  if (fatal) throw new ParseError(`CSV 解析失败（第 ${(fatal.row ?? 0) + 1} 行附近）：${fatal.message}`);
  return result.data;
}

export function parseGrid(buf: ArrayBuffer, ext: string): Promise<string[][]> {
  if (ext === 'csv') return Promise.resolve(parseCsv(decodeText(buf).text));
  return import('@e965/xlsx').then((XLSX) => {
    let workbook;
    try {
      workbook = XLSX.read(buf, { type: 'array' });
    } catch {
      throw new ParseError('这个 Excel 文件无法读取，文件可能已损坏，或不是标准的 .xlsx / .xls 格式。');
    }
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' });
    return grid.map((r) => (r ?? []).map((c) => String(c ?? '').trim()));
  });
}

export async function parseFile(file: File): Promise<Dataset> {
  const ext = fileExtension(file.name);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new ParseError(`暂不支持 .${ext || '?'} 格式，请上传 CSV 或 Excel（.xlsx / .xls）文件。`);
  }
  const buf = await file.arrayBuffer();
  if (buf.byteLength === 0) throw new ParseError('文件是空的，请重新从问卷平台导出。');
  const { text, encoding } = ext === 'csv' ? decodeText(buf) : { text: '', encoding: 'Excel' };
  const grid = ext === 'csv' ? parseCsv(text).map((r) => r.map((c) => c.trim())) : await parseGrid(buf, ext);
  return buildDataset(grid, file.name, encoding);
}

export function buildDataset(grid: string[][], fileName: string, encoding: string): Dataset {
  const body = grid.filter((r) => r.some((c) => c !== ''));
  if (body.length === 0) throw new ParseError('文件里没有读到任何数据。');
  if (body.length - 1 > MAX_ROWS) {
    throw new ParseError(`文件有 ${body.length - 1} 行数据，超过了 ${MAX_ROWS} 行上限。请拆分文件后再试。`);
  }

  const head = body.slice(0, 5);
  let headerIdx = 0;
  let best = -1;
  head.forEach((r, i) => {
    const filled = r.filter((c) => c !== '').length;
    if (filled > best) {
      best = filled;
      headerIdx = i;
    }
  });
  if (best === 1) throw new ParseError('没有识别到表头：第一行应当是题目名称，每个题目占一列。');

  const rawHeaders = body[headerIdx];
  const dataRows = body.slice(headerIdx + 1);
  const keep = rawHeaders
    .map((_, i) => i)
    .filter((i) => rawHeaders[i] !== '' || dataRows.some((r) => r[i] !== ''));
  if (keep.length === 0) throw new ParseError('文件里没有读到任何数据。');

  const seen = new Map<string, number>();
  const headers = keep.map((i) => {
    const base = rawHeaders[i] === '' ? `第 ${i + 1} 列` : rawHeaders[i];
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
  const rows = dataRows.map((r) => Object.fromEntries(keep.map((i, k) => [headers[k], r[i] ?? ''])));

  return {
    fileName,
    importedAt: new Date().toISOString(),
    encoding,
    skippedRows: headerIdx,
    headers,
    rows,
    questions: inferQuestions(headers, rows),
  };
}
