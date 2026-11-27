import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 固定随机种子，保证每次生成的示例问卷完全一致。
const SEED = 20261126;
const N = 128;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo-survey.csv');

function rng(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}
function subset(pairs, max) {
  const chosen = pairs.filter(([, w]) => rand() < w);
  const list = chosen.length ? chosen : [pairs[0]];
  return [...list].sort(() => rand() - 0.5).slice(0, max).map(([v]) => v).join('┋');
}
// 均值 0、标准差约 1 的近似正态：三个均匀分布相加再放大。
const normal = () => (rand() + rand() + rand() - 1.5) * 2;
const pad = (n) => String(n).padStart(2, '0');
const cell = (v) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const grade = [
  ['大一', 18], ['大二', 30], ['大三', 32], ['大四', 12], ['研究生', 8],
];
const major = [
  ['理工类', 48], ['经管类', 22], ['人文社科类', 18], ['医学类', 6], ['艺术类', 6],
];
const gender = [['男', 52], ['女', 47], ['不愿透露', 1]];
const freq = [
  ['每天多次', 31], ['每天一次', 25], ['每周几次', 27], ['每月几次', 10], ['几乎不用', 7],
];
const tools = [
  ['DeepSeek', 0.72], ['豆包', 0.55], ['Kimi', 0.44], ['ChatGPT', 0.39], ['通义千问', 0.27],
  ['GitHub Copilot', 0.19], ['Claude', 0.17], ['文心一言', 0.12], ['其他', 0.04],
];
const uses = [
  ['查资料、解释概念', 0.68], ['写作润色', 0.57], ['写代码、改 bug', 0.41], ['翻译', 0.39],
  ['头脑风暴', 0.33], ['整理笔记', 0.30], ['做 PPT 或配图', 0.22], ['其他', 0.03],
];
const help = [[1, 2], [2, 5], [3, 27], [4, 49], [5, 45]];
const acc = [[1, 6], [2, 17], [3, 44], [4, 47], [5, 14]];
const courses = [
  ['使用技巧入门', 0.5], ['提示词写法', 0.45], ['结合专业课的案例', 0.52], ['AI 伦理与学术规范', 0.41],
  ['编程与自动化', 0.3], ['不需要这类课程', 0.05],
];

const problems = [
  '有时候会编造参考文献，查资料不放心',
  '回答太笼统，要追问很多次才有有用的内容',
  '数学推导和公式经常出错，不敢直接用',
  '用多了会产生依赖，自己懒得思考',
  '答案不准确，还得自己去核实',
  '内容偏泛泛而谈，没有针对课程的深度',
  '免费版有限额，高峰期经常卡顿',
  '边界不清楚，担心被判定为学术不端',
  '对中文文献的支持比较差',
  '联网搜到的资料有时是过时的',
  '不知道怎么写出好的提示词',
  '生成的内容大同小异，缺少新意',
  '长文档读不完，超过篇幅就开始乱总结',
  '不敢把没发表的论文放进去，担心泄露',
  '代码能跑但看不懂，感觉学不到东西',
  '价格偏贵，学生负担不起',
  '公式排版经常出问题',
  '有时候答非所问，理解不了具体的语境',
  '引用来源打不开或者根本不存在',
];
const suggestions = [
  '希望开一门选修课，教怎么用在专业课里',
  '希望学校统一采购，给学生免费额度',
  '多一些针对毕业论文写作的讲座',
  '希望明确哪些用法算学术不端',
  '建议图书馆办几场工作坊',
  '可以建一个交流群，大家分享好用的用法',
  '不要一刀切禁止，引导学生正确使用',
  '提供可以本地部署的开源模型',
  '老师上课也应该学一学怎么用',
  '增加实操课，少讲一些理论',
  '希望有针对不同专业的使用手册',
  '没想好',
  '没什么建议',
  '无所谓，靠自己摸索就行',
  '把课程录屏发出来，方便回看',
];

const rows = [];
for (let i = 1; i <= N; i++) {
  const f = weighted(freq);
  const heavy = f === '每天多次' ? 2.6 : f === '每天一次' ? 1.7 : f === '每周几次' ? 1.1 : 0.5;
  const hours = Math.round(-Math.log(1 - rand()) * heavy * 3.4 * 2) / 2;
  const payRoll = rand();
  let pay = 0;
  if (payRoll > 0.4) pay = pick([5, 10, 15, 20, 20, 30, 49, 50, 68, 69, 99, 120, 199]);
  if (rand() < 0.08) pay = '';
  const toolBias = f === '几乎不用' ? 0.35 : 1;
  const month = pick(['10', '10', '10', '11']);
  const day = pad(1 + Math.floor(rand() * 25));
  const time = `2026/${month}/${day} ${pad(Math.floor(rand() * 24))}:${pad(Math.floor(rand() * 60))}:${pad(Math.floor(rand() * 60))}`;
  // 每 19 份里有一份敷衍作答：时间很短，题组里全选 3。
  const careless = i % 19 === 0;
  const seconds = careless ? 25 + Math.floor(rand() * 30) : Math.round(230 + normal() * 70);
  // 题组的三个子项由一个共同的潜在因子生成，彼此相关，α 在 0.8 左右。
  const factor = normal();
  const effect = (loading) => String(Math.min(5, Math.max(1, Math.round(3.4 + loading * factor + 0.7 * normal()))));

  rows.push([
    i,
    time,
    seconds,
    weighted(grade),
    weighted(gender),
    weighted(major),
    f,
    subset(tools.map(([v, w]) => [v, w * toolBias]), 9),
    subset(uses.map(([v, w]) => [v, w * toolBias]), 8),
    weighted(help),
    weighted(acc),
    hours,
    pay,
    rand() < 0.06 ? '-' : pick(problems),
    subset(courses, 6),
    rand() < 0.35 ? '' : pick(suggestions),
    careless ? '3' : effect(0.9),
    careless ? '3' : effect(0.85),
    careless ? '3' : effect(0.8),
  ]);
}

const header = [
  '序号',
  '提交答卷时间',
  '答题时长',
  '1、您的年级是？',
  '2、您的性别是？',
  '3、您的专业类别是？',
  '4、您使用 AI 工具的频率是？',
  '5、您使用过哪些 AI 工具？（多选）',
  '6、您主要用 AI 工具做什么？（多选）',
  '7、AI 工具对您的学习有多大帮助？（1–5 分）',
  '8、您对 AI 工具回答准确性的满意度（1–5 分）',
  '9、您平均每周花多少小时使用 AI 工具？',
  '10、您每月愿意为 AI 工具支付多少元？',
  '11、您认为当前 AI 工具在学习中最大的问题是什么？',
  '12、您希望学校开设哪些 AI 工具相关课程？（多选）',
  '13、您对学校的 AI 工具支持有什么建议？',
  '第14题(提高学习效率)',
  '第14题(拓宽知识面)',
  '第14题(节省时间)',
];

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, '\ufeff' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n');
console.log(`wrote ${rows.length} responses to ${OUT}`);
