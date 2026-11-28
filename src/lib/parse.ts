import Papa from 'papaparse';
import type { Dataset } from '../types.ts';
import { inferQuestions, splitStem } from './infer.ts';
import { detectProfile, formatOf, normalizeMissing } from './exportProfiles.ts';
import { annotateSchema, normalizeStructure } from './schemaInference.ts';

export class ParseError extends Error {}

const MAX_ROWS = 20000;

export const SUPPORTED_EXTENSIONS = ['csv', 'xlsx', 'xls'];

export function fileExtension(name: string) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

// 非 UTF-8 文件可能是 GBK/GB18030、Big5 或西文 Windows-1252，逐种解码后按「像不像正常文本」打分取最高。
// 常见汉字表只覆盖问卷里高频出现的字，用来区分正确解码和乱码，不追求完整字频表。
const COMMON_HAN = new Set(
  (
    '的一是不了在人有我他她它这這个個们們中来來上大为為和国國地到以说說时要時就出会會可也你对對生能而子那得于於着著下自之年过過发發后後作里裡用道行所然家种種事成方多经經么麼去法学學如都同现現当當没沒动動面起看定天分还還进進好小部其些主样樣理心本前开開但因只从從想实實' +
    '日二三四五六七八九十百千万萬年月號号點点秒姓名性別别年龄齡城區区縣县省街道路村镇鎮滿满度非常比較较一般喜喜欢歡推荐薦支持反对對同意希望建议議意见見问题題回答问卷卷调查調查数据據分析报告報告统计統計结果結果显示顯示范範圍围内容內容' +
    '学校學校公司企业業单位單位部门部門工作职业職業收入工资資价格價格产品產品质量質量服务服務环境環境交通方便位置学生學生老师老師教师教師医生醫生医院醫院教育学习學習课程課程考试考試作业業毕业畢業就业就業实习實習兼职職薪资資' +
    '朋友网络網絡广告廣告渠道购买買考虑慮因素健康营养營養口味包装裝选择選擇评价評價改进進提高加强強增加减少減少提供讲座講座指导指導培训培訓帮助幫助需求需要想要计划計劃未来來目前现在現在过去過今后後以前后面後' +
    '男女学历學歷本科研究生硕士碩士博士高中初中小学小學每天每周次元小时時天周个月個其余餘全部所有大部分一些这些這些那些种类類型号號品牌款式颜色顏安全卫生衛生舒适適漂亮实用實便宜免费費付费線上线上线下線下实体實體店超市商场場餐厅廳饭店飯店酒店宾馆賓館公园園' +
    '图书馆圖書館车站車站机场機場火车車汽車汽车地铁鐵公交自行车自行車步出租车車网约網約驾车駕旅游旅遊出差休闲閒娱乐娛樂运动運動阅读閱讀音乐音樂电影電影游戏遊戲视频視頻直播社交新闻新聞资讯資訊医疗醫療保险保險休假加班通勤住房租房买房買房贷款貸款存款投资投資理财理財消费消費购物購物支出' +
    '家庭父母子女配偶邻居鄰居社区社區城乡鄉农村農村污染能源气候氣候天气天氣季节季節春夏秋冬左右前后後东西東西南北内外附近周围周圍整体整體具体體特别別十分稍微更最第另别別再还還都就才只又已经經正在将要將应该應該必须須愿意願打打算决定決定尝试嘗試努力了解知道认为認為觉得覺得感觉覺看到听到聽到遇到想到做到得到达到達到收到找到'
  ).split(''),
);

const WESTERN_LETTERS = new Set('àáâãäåæçèéêëìíîïñòóôõöøùúûüýþÿœÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝŒ'.split(''));

function legacyScore(text: string) {
  let score = 0;
  let count = 0;
  let latinRun = 0;
  for (const ch of text) {
    if (count >= 4000) break;
    count++;
    const cp = ch.codePointAt(0)!;
    if (ch === '\uFFFD') {
      score -= 8;
      latinRun = 0;
    } else if (cp < 0x20) {
      score += ch === '\n' || ch === '\r' || ch === '\t' ? 1 : -8;
      latinRun = 0;
    } else if (cp < 0x7f) {
      score += 1;
      latinRun = 0;
    } else if (cp <= 0x9f) {
      score -= 8;
      latinRun = 0;
    } else if (cp >= 0x3400 && cp <= 0x9fff) {
      score += COMMON_HAN.has(ch) ? 3 : 0.2;
      latinRun = 0;
    } else if (cp >= 0x20000 && cp <= 0x2fa1f) {
      score += 0.5;
      latinRun = 0;
    } else if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x2000 && cp <= 0x206f) || (cp >= 0xff00 && cp <= 0xffef)) {
      score -= 1;
      latinRun = 0;
    } else if (cp <= 0x24f) {
      score += WESTERN_LETTERS.has(ch) ? 1.2 : -1;
      // 中文按西文解码时，一个汉字会变成连续两个高位字符；正常西文很少这样。
      if (latinRun > 0) score -= 1.5;
      latinRun++;
    } else {
      score -= 1.5;
      latinRun = 0;
    }
  }
  return score / Math.max(1, count);
}

const LEGACY_DECODERS = [
  { encoding: 'GB18030', decoder: new TextDecoder('gb18030') },
  { encoding: 'Big5', decoder: new TextDecoder('big5') },
  { encoding: 'Windows-1252', decoder: new TextDecoder('windows-1252') },
];

function hasFourByteGb18030(bytes: Uint8Array) {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] >= 0x81 && bytes[i] <= 0xfe && bytes[i + 1] >= 0x30 && bytes[i + 1] <= 0x39 && bytes[i + 2] >= 0x81 && bytes[i + 2] <= 0xfe && bytes[i + 3] >= 0x30 && bytes[i + 3] <= 0x39) {
      return true;
    }
  }
  return false;
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
    // 坏字节很少时，宽容解码的 UTF-8 通常仍保留全部正文；参与打分后，坏字符多的解码会自然落败。
    const lenient = new TextDecoder('utf-8').decode(bytes);
    let best = { text: lenient, encoding: 'UTF-8', score: legacyScore(lenient) };
    for (const { encoding, decoder } of LEGACY_DECODERS) {
      const text = decoder.decode(bytes);
      const score = legacyScore(text);
      if (score > best.score) best = { text, encoding, score };
    }
    if (best.encoding === 'GB18030' && !hasFourByteGb18030(bytes)) best.encoding = 'GBK';
    return { text: best.text, encoding: best.encoding };
  }
}

export function parseCsv(text: string): string[][] {
  const result = Papa.parse<string[]>(text, { header: false, skipEmptyLines: 'greedy' });
  // 列数不一致只影响个别行，交给后续处理；引号不闭合、分隔符识别失败才是硬错误。
  const fatal = result.errors.find((e) => e.code !== 'TooFewFields' && e.code !== 'TooManyFields');
  if (fatal) throw new ParseError(`CSV 解析失败（第 ${(fatal.row ?? 0) + 1} 行附近）：${fatal.message}`);
  return result.data;
}

export async function parseWorkbook(buf: ArrayBuffer): Promise<{ grid: string[][]; sheet: string }> {
  const XLSX = await import('@e965/xlsx');
  let workbook;
  try {
    workbook = XLSX.read(buf, { type: 'array' });
  } catch {
    throw new ParseError('这个 Excel 文件无法读取，文件可能已损坏，或不是标准的 .xlsx / .xls 格式。');
  }
  let best = { grid: [] as string[][], sheet: '', cells: 0 };
  for (const name of workbook.SheetNames) {
    const grid = XLSX.utils
      .sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: false, defval: '' })
      .map((r) => (r ?? []).map((c) => String(c ?? '').trim()));
    const cells = grid.reduce((sum, r) => sum + r.filter((c) => c !== '').length, 0);
    // 导出文件的首个工作表常是说明页，取非空单元格最多的工作表作为数据表。
    if (cells > best.cells) best = { grid, sheet: name, cells };
  }
  return { grid: best.grid, sheet: best.sheet };
}

export function parseGrid(buf: ArrayBuffer, ext: string): Promise<string[][]> {
  if (ext === 'csv') return Promise.resolve(parseCsv(decodeText(buf).text));
  return parseWorkbook(buf).then((w) => w.grid);
}

export async function parseFile(file: File): Promise<Dataset> {
  const ext = fileExtension(file.name);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new ParseError(`暂不支持 .${ext || '?'} 格式，请上传 CSV 或 Excel（.xlsx / .xls）文件。`);
  }
  const buf = await file.arrayBuffer();
  if (buf.byteLength === 0) throw new ParseError('文件是空的，请重新从问卷平台导出。');
  if (ext === 'csv') {
    const { text, encoding } = decodeText(buf);
    return buildDataset(parseCsv(text).map((r) => r.map((c) => c.trim())), file.name, encoding);
  }
  const { grid, sheet } = await parseWorkbook(buf);
  return buildDataset(grid, file.name, 'Excel', sheet);
}

export function buildDataset(grid: string[][], fileName: string, encoding: string, sheet?: string): Dataset {
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
  const duplicateHeaders = rawHeaders.filter((h, i) => h !== '' && rawHeaders.indexOf(h) !== i).length;
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
  const rawRows = dataRows.map((r) => Object.fromEntries(keep.map((i, k) => [headers[k], r[i] ?? ''])));

  const profile = detectProfile(headers);
  const missing = normalizeMissing(rawRows, profile.missingTokens);
  const structure = normalizeStructure(headers, missing.rows);
  // Google Forms 分支题常生成重复表头且整列为空；这类列不生成题目。
  const emptyDuplicates = new Set(
    structure.headers.filter((h) => / \(\d+\)$/.test(h) && structure.rows.every((r) => (r[h] ?? '').trim() === '')),
  );
  const cleanedHeaders = emptyDuplicates.size > 0 ? structure.headers.filter((h) => !emptyDuplicates.has(h)) : structure.headers;
  const cleanedRows =
    emptyDuplicates.size > 0
      ? structure.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !emptyDuplicates.has(k))))
      : structure.rows;
  const merged = mergeOptionColumns(cleanedHeaders, cleanedRows);
  const inferred = inferQuestions(merged.headers, merged.rows);
  // 平台系统列即使不在通用 META 列表里，也按元数据忽略。
  if (profile.systemColumns.length > 0) {
    for (const q of inferred.questions) {
      if (profile.systemColumns.some((re) => re.test(q.rawTitle.trim()))) {
        q.type = 'meta';
        q.included = false;
      }
    }
  }
  const formatNotes = [...structure.notes];
  if (missing.touched > 0) formatNotes.push(`${profile.label} 缺失码按缺失处理（${missing.touched} 行）`);
  if (profile.id === 'qualtrics') {
    const finished = rawRows.filter((r) => (r['Finished'] ?? '').trim() === '0').length;
    if (finished > 0) formatNotes.push(`含 ${finished} 份 Finished=0（未完成）的答卷，当前保留`);
  }
  if (duplicateHeaders > 0) formatNotes.push(`有 ${duplicateHeaders} 个重复表头（分支题），已按列保留`);
  if (emptyDuplicates.size > 0) formatNotes.push(`忽略 ${emptyDuplicates.size} 个全空的分支列`);
  return {
    fileName,
    importedAt: new Date().toISOString(),
    encoding,
    ...(sheet ? { sheet } : {}),
    skippedRows: headerIdx,
    headers: merged.headers,
    rows: merged.rows,
    questions: annotateSchema(inferred.questions, merged.rows, profile),
    groups: inferred.groups,
    format: formatOf(profile, formatNotes),
  };
}

// 问卷星「按选项序号导出」把一道多选题拆成 第N题(选项) 的 0/1 列，这里合回一道多选题。
function mergeOptionColumns(headers: string[], rows: Record<string, string>[]) {
  const stems = new Map<string, string[]>();
  for (const h of headers) {
    const s = splitStem(h);
    if (!s || !/^第\s*\d+\s*题$/.test(s.stem)) continue;
    stems.set(s.stem, [...(stems.get(s.stem) ?? []), h]);
  }

  const replaced = new Map<string, string>();
  const removed = new Set<string>();
  let mergedAny = false;
  const outRows = rows.map((r) => ({ ...r }));

  for (const [stem, members] of stems) {
    if (members.length < 2) continue;
    const binary = rows.every((r) => members.every((h) => ['', '0', '1'].includes((r[h] ?? '').trim())));
    if (!binary) continue;
    const name = `${stem}（多选）`;
    for (const r of outRows) {
      r[name] = members
        .filter((h) => (r[h] ?? '').trim() === '1')
        .map((h) => splitStem(h)?.sub ?? h)
        .join('┋');
    }
    replaced.set(members[0], name);
    members.slice(1).forEach((h) => removed.add(h));
    mergedAny = true;
  }

  if (!mergedAny) return { headers, rows };
  return { headers: headers.filter((h) => !removed.has(h)).map((h) => replaced.get(h) ?? h), rows: outRows };
}
