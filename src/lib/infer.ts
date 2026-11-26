import type { Question, QuestionGroup, QuestionType } from '../types.ts';
import { cleanTitle, isAnswer } from './text.ts';

const META = /^(?:序号|编号|问卷编号|答卷编号|id|no|num|index|uuid|guid|开始(?:答题|答卷|填写)?(?:时间|日期)|结束(?:答题|答卷|填写)?(?:时间|日期)|完成(?:时间|日期)|提交(?:答卷)?(?:时间|日期)|(?:答题|答卷|填写|作答)(?:时间|日期|时长)|提交时间戳|时间戳|所用时间|用时|耗时|来源|来源渠道|来源详情|来自ip|ip地址|ip|ua|user.?agent|referrer|浏览器|操作系统|设备|设备类型|终端|地理位置.*|姓名|名字|学号|工号|手机(?:号|号码)?|电话|邮箱|e-?mail|微信|openid|用户名|用户id|uid|语言|清洗数据结果|清洗数据.*|智能清洗.*|无效概率|自定义字段)$/i;

const MULTI_HINT = /多选|任选|multiple\s*choice/i;
const SINGLE_HINT = /单选|单选题/;
const SCALE_MARK = /[（(【\[]\s*(?:量表题?|评分题?|打分题?|nps)\s*[）)】\]]|量表题$/i;
const SCALE_HINT = /1\s*[-–—~至到]\s*\d+\s*分|量表|评分|打分|满意度|(?:同意|认同|愿意|了解|符合|支持|接受)程度|非常不同意|nps/i;
const NUMERIC_HINT = /金额|费用|价格|多少钱|多少元|支付|年龄|时长|小时|分钟|天数|次数|收入|工资|薪资|身高|体重|距离|人数|数量|分数|总分|得分|cc|排量/;
const OPEN_HINT = /建议|原因|为何|为什么|什么问题|问题是什么|什么建议|期待|期望|看法|意见|想法|评价|说明|描述|谈谈|留言|补充|理由|感受|吐槽|访谈|想一想|写一写|请输入|请填写|请说明|简述|简要|怎么|如何|哪些|请列举|请具体/;
const STRONG_OPEN = /建议|原因|为何|为什么|什么问题|问题是什么|什么建议|期待|期望|看法|意见|想法|评价|说明|描述|谈谈|留言|补充|理由|感受|吐槽|访谈|想一想|写一写|请说明|简述|简要|怎么|如何/;

const MULTI_SEP = /[;；|┋]/;
const OTHER_NOTE = /^(.*?)\s*[〖\[［]([^〖〗\[\]［］]*)[〗\]］]\s*$/;

const SPLIT_STEM = /^(第\s*\d+\s*题)\s*[(（](.+)[)）]\s*$/;
const BRACKET_STEM = /^(.+?)\s*[\[【]([^\[\]【】]+)[\]】]\s*$/;
const GROUP_MARKERS = new Set(['单选', '多选', '量表', '填空', '简答', '开放', '评分', '打分', '排序']);

// 常见文本量表按固定分值计分，保证同一份问卷的不同题可比。
const LIKERT: Record<string, number> = {
  完全不符合: 1, 非常不符合: 1, 很不符合: 1,
  不符合: 2, 比较不符合: 2, 不太符合: 2, 有些不符合: 2,
  一般: 3, 一般般: 3, 中立: 3, 不确定: 3, 说不好: 3,
  比较符合: 4, 有些符合: 4, 基本符合: 4, 符合: 4,
  非常符合: 5, 完全符合: 5,
  非常不同意: 1, 很不同意: 1, 完全不同意: 1,
  不同意: 2, 比较不同意: 2, 不太同意: 2,
  同意: 4, 比较同意: 4, 非常同意: 5, 完全同意: 5,
  非常不满意: 1, 不满意: 2, 比较不满意: 2,
  满意: 4, 比较满意: 4, 非常满意: 5,
  完全不关注: 1, 不关注: 2, 比较不关注: 2,
  关注: 4, 比较关注: 4, 非常关注: 5,
  完全不愿意: 1, 不愿意: 2, 比较不愿意: 2,
  愿意: 4, 比较愿意: 4, 非常愿意: 5,
};

export function splitMultiDetailed(value: string): { name: string; note?: string }[] {
  const seen = new Set<string>();
  const out: { name: string; note?: string }[] = [];
  for (const raw of value.split(MULTI_SEP).map((s) => s.trim())) {
    if (raw === '') continue;
    const m = OTHER_NOTE.exec(raw);
    const name = (m ? m[1] : raw).trim() || raw;
    if (seen.has(name)) continue;
    seen.add(name);
    const note = m?.[2].trim();
    out.push(note ? { name, note } : { name });
  }
  return out;
}

export function splitMulti(value: string) {
  return splitMultiDetailed(value).map((x) => x.name);
}

function toNumber(v: string) {
  const s = v.replace(/[,，\s]/g, '').replace(/元|小时|分钟|次|岁|人|斤|km|cm|kg|%$/i, '');
  if (s === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

export function numericValues(values: string[]) {
  return values.map(toNumber).filter((n) => Number.isFinite(n));
}

export function likertScore(label: string): number | null {
  return LIKERT[label.trim()] ?? null;
}

export function isLikert(values: string[]) {
  const distinct = [...new Set(values)];
  if (distinct.length < 3 || distinct.length > 7) return false;
  const scores = distinct.map(likertScore);
  return scores.every((s) => s !== null) && new Set(scores).size >= 3;
}

// 表头形如「第6题(运动)」或「题干[子项]」时返回题组题干和子项名。
export function splitStem(header: string): { stem: string; sub: string } | null {
  const raw = header.trim();
  const m = SPLIT_STEM.exec(raw);
  if (m) return { stem: m[1].replace(/\s+/g, ''), sub: m[2].trim() };
  const b = BRACKET_STEM.exec(raw);
  if (b) return { stem: b[1].trim(), sub: b[2].trim() };
  return null;
}

function codeLike(nums: number[]) {
  if (nums.length === 0) return false;
  if (!nums.every((n) => Number.isInteger(n))) return false;
  const distinct = new Set(nums);
  return distinct.size >= 2 && Math.min(...nums) >= 1 && Math.max(...nums) <= 10;
}

// 多选题导出的文本列（A;B;D）与带分号的开放回答长得很像。
// 只有拆出来的片段短、且反复出现少数几个相同选项时，才按多选处理。
function multiLike(valid: string[]) {
  if (valid.length < 5) return false;
  const withSep = valid.filter((v) => MULTI_SEP.test(v));
  if (withSep.length / valid.length < 0.3) return false;
  const parts = valid.flatMap((v) => splitMulti(v));
  if (parts.length === 0) return false;
  const distinct = new Set(parts);
  if (distinct.size > 30) return false;
  const avgLen = parts.reduce((s, p) => s + p.length, 0) / parts.length;
  return avgLen <= 20 && distinct.size / parts.length <= 0.6;
}

export function inferType(rawTitle: string, values: string[], opts: { grouped?: boolean } = {}): QuestionType {
  const raw = rawTitle.trim();
  const title = cleanTitle(raw);
  const valid = values.filter(isAnswer);
  const distinct = new Set(valid);
  const nums = numericValues(valid);
  const numericRatio = valid.length === 0 ? 0 : nums.length / valid.length;
  const avgLen = valid.length === 0 ? 0 : valid.reduce((s, v) => s + v.length, 0) / valid.length;
  const repeat = valid.length === 0 ? 0 : distinct.size / valid.length;

  if (META.test(raw) || META.test(title)) return 'meta';
  if (valid.length === 0) return MULTI_HINT.test(raw) || MULTI_HINT.test(title) ? 'multi' : 'single';

  // 表头写明的题型优先于按取值猜测。
  if (MULTI_HINT.test(raw) || MULTI_HINT.test(title)) return 'multi';
  if (SINGLE_HINT.test(raw) || SINGLE_HINT.test(title)) return 'single';
  if (SCALE_MARK.test(raw) || SCALE_MARK.test(title)) return 'scale';

  if (isLikert(valid)) return 'scale';
  if (STRONG_OPEN.test(title) && (distinct.size > 20 || avgLen >= 4)) return 'open';
  if (multiLike(valid)) return 'multi';
  if (OPEN_HINT.test(title) && (distinct.size > 20 || avgLen >= 4)) return 'open';

  if (SCALE_HINT.test(title)) return 'scale';

  // 按选项序号导出的数据用 1..10 的整数代表选项，不是量表分数。
  const coded = numericRatio === 1 && codeLike(nums);
  if (coded && opts.grouped) return 'scale';
  if (coded) return 'single';

  if (numericRatio >= 0.9 && (NUMERIC_HINT.test(title) || distinct.size > 12)) return 'numeric';

  // 选项很少或反复出现同一批短标签时是选择题，不是开放题。
  if (distinct.size <= 10) return 'single';
  if (avgLen < 6 && repeat < 0.5) return 'single';
  if (distinct.size > 20 || avgLen >= 15) return 'open';
  return repeat < 0.5 ? 'single' : 'open';
}

function splitMultiHeader(header: string) {
  return /（多选）$/.test(header) || /\(多选\)$/.test(header);
}

export function inferQuestions(headers: string[], rows: Record<string, string>[]): { questions: Question[]; groups: QuestionGroup[] } {
  const stems = new Map<string, string[]>();
  for (const h of headers) {
    if (splitMultiHeader(h)) continue;
    const s = splitStem(h);
    if (!s || GROUP_MARKERS.has(s.sub)) continue;
    stems.set(s.stem, [...(stems.get(s.stem) ?? []), h]);
  }

  const groupOf = new Map<string, string>();
  const groups: QuestionGroup[] = [];
  for (const [stem, members] of stems) {
    if (members.length < 2) continue;
    const id = `g:${stem}`;
    groups.push({ id, title: cleanTitle(stem) || stem, questionIds: members });
    for (const h of members) groupOf.set(h, id);
  }

  const questions: Question[] = headers.map((h) => {
    const groupId = groupOf.get(h);
    const sub = groupId ? splitStem(h)?.sub : undefined;
    const stem = groupId ? groups.find((g) => g.id === groupId)?.title : undefined;
    const type = inferType(h, rows.map((r) => r[h]), { grouped: !!groupId });
    return {
      id: h,
      rawTitle: h,
      title: sub ? (stem ? `${stem} · ${sub}` : sub) : cleanTitle(h),
      subTitle: sub,
      type,
      included: type !== 'meta',
      ...(groupId ? { groupId } : {}),
    };
  });
  return { questions, groups };
}