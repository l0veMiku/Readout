import type { Question, QuestionType } from '../types.ts';
import { cleanTitle, isAnswer } from './text.ts';

const META = /^(?:序号|编号|问卷编号|答卷编号|id|no|num|index|uuid|guid|提交.*(?:时间|日期)|(?:答卷|填写|作答|答题)(?:时间|日期)|(?:提交|填写)?时间戳|来源|来源渠道|渠道|来自ip|ip地址|ip|所用时间|答题时长|地区|省份|城市|姓名|名字|学号|工号|手机(?:号|号码)?|电话|邮箱|e-?mail|微信|openid|用户名|用户id|uid|设备|设备类型|浏览器|操作系统|终端)$/i;

const MULTI_HINT = /多选|任选|multiple\s*choice/i;
const SCALE_HINT = /1\s*[-–—~至到]\s*\d+\s*分?$|量表|评分|打分|满意度|(?:同意|认同|愿意|了解|符合|支持|接受)程度$|非常不同意|nps/i;
const NUMERIC_HINT = /金额|费用|价格|多少钱|多少元|支付|年龄|时长|小时|分钟|天数|次数|收入|工资|薪资|身高|体重|距离|人数|数量|分数|cc|排量/;
const OPEN_HINT = /建议|原因|为何|为什么|期待|期望|看法|意见|想法|评价|说明|描述|谈谈|留言|补充|理由|感受|吐槽|访谈|想一想|写一写/;

const MULTI_SEP = /[;；|┋]/;

export function splitMulti(value: string) {
  const seen = new Set<string>();
  for (const t of value.split(MULTI_SEP).map((s) => s.trim())) {
    if (t !== '') seen.add(t);
  }
  return [...seen];
}

function toNumber(v: string) {
  const s = v.replace(/[,，\s]/g, '').replace(/元|小时|分钟|次|岁|人|斤|km|cm|kg|%$/i, '');
  if (s === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

export function numericValues(values: string[]) {
  return values.map(toNumber).filter((n) => Number.isFinite(n));
}

export function inferType(rawTitle: string, values: string[]): QuestionType {
  const raw = rawTitle.trim();
  const title = cleanTitle(raw);
  const valid = values.filter(isAnswer);
  const distinct = new Set(valid);
  const nums = numericValues(valid);
  const numericRatio = valid.length === 0 ? 0 : nums.length / valid.length;
  const avgLen = valid.length === 0 ? 0 : valid.reduce((s, v) => s + v.length, 0) / valid.length;

  if (META.test(raw) || META.test(title)) return 'meta';
  if (valid.length === 0) return 'single';

  if (MULTI_HINT.test(raw) || MULTI_HINT.test(title)) return 'multi';
  const withSep = valid.filter((v) => MULTI_SEP.test(v)).length;
  if (valid.length >= 5 && withSep / valid.length >= 0.3 && valid.every((v) => splitMulti(v).length <= 60)) return 'multi';

  if (OPEN_HINT.test(title) && (distinct.size > 20 || avgLen >= 4)) return 'open';

  if (SCALE_HINT.test(title)) return 'scale';
  const allInt1to10 = nums.length === valid.length && nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 10);
  if (allInt1to10 && distinct.size <= 7) return 'scale';

  if (numericRatio >= 0.9 && (NUMERIC_HINT.test(title) || distinct.size > 12)) return 'numeric';

  if (distinct.size > 20 || avgLen >= 15) return 'open';
  if (distinct.size <= 20) return 'single';
  return 'open';
}

export function inferQuestions(headers: string[], rows: Record<string, string>[]): Question[] {
  return headers.map((h) => {
    const type = inferType(h, rows.map((r) => r[h]));
    return { id: h, rawTitle: h, title: cleanTitle(h), type, included: type !== 'meta' };
  });
}
