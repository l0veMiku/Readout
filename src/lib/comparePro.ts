import type { CorrectionMethod, ProModeOptions } from '../types.ts';
import type { Comparison, Diff } from './compare.ts';
import { adjustP } from './adjust.ts';
import { kruskalWallis, mannWhitneyU } from './ranks.ts';
import { formatNumber, formatP, formatRange } from './text.ts';

export const CORRECTION_LABELS: Record<CorrectionMethod, string> = {
  holm: 'Holm',
  bh: 'Benjamini–Hochberg',
};

const amount = (x: number) => formatNumber(x, 2);

// 判定用的 p：秩检验时用秩检验的 p，否则用原 p；校正只改判定，不改区间。
function decide(diffs: (Diff | null)[], adjust: CorrectionMethod | null): (Diff | null)[] {
  const raw = diffs.map((d) => (d ? (d.rankP ?? d.p) : null));
  const adjusted = adjust ? adjustP(raw.map((p) => p ?? Number.NaN), adjust) : raw;
  return diffs.map((d, i) => {
    if (!d) return d;
    const p = adjusted[i];
    const usable = p !== null && !Number.isNaN(p);
    return { ...d, pAdjusted: adjust ? (usable ? p : null) : null, clear: usable ? (p as number) < 0.05 : false };
  });
}

interface PhraseOptions {
  rank: boolean;
  adjust: boolean;
}

function phrase(name: string, d: Diff, unit: string, opts: PhraseOptions) {
  const size = `${d.diff > 0 ? '高' : '低'} ${amount(Math.abs(d.diff))}${unit}`;
  const ci = `95% 区间 ${formatRange(d.lower, d.upper, amount)}`;
  const p = opts.adjust ? `校正后 p = ${formatP(d.pAdjusted ?? 1)}` : `p = ${formatP(opts.rank ? (d.rankP ?? 1) : (d.p ?? 1))}`;
  const raw = opts.rank ? (d.rankP ?? null) : (d.p ?? null);
  const rawText = raw === null ? '' : `p = ${formatP(raw)}${opts.adjust ? `（校正后 ${formatP(d.pAdjusted ?? 1)}）` : ''}`;
  const stat = opts.rank ? `秩检验 ${rawText}${d.rankR !== null && d.rankR !== undefined ? `，r = ${formatNumber(d.rankR, 2)}` : ''}` : `${size}，${ci}；${p}`;
  return d.clear ? `${name} 存在差别（${stat}）` : `${name} 没有看到明确差别（${stat}）`;
}

// 专业模式对交叉分析的后处理：秩检验、多重比较校正，以及据此改写的结论句。
// 专业模式关闭时原样返回，默认口径逐项不变。
export function withProMode(comparison: Comparison, pro: ProModeOptions): Comparison {
  if (!pro.on || (!pro.correction && !pro.rankTest)) return comparison;
  const adjust = pro.correction;

  if (comparison.mode === 'mean') {
    const row = comparison.rows[0];
    if (!row) return comparison;
    let diffs = row.diffs;
    let rank = comparison.rank;
    if (pro.rankTest && comparison.groupSamples && comparison.groupSamples.length >= 2) {
      const [baseline, ...others] = comparison.groupSamples;
      const pairs = others.map((xs) => mannWhitneyU(xs, baseline));
      rank = { pairs, overall: kruskalWallis(comparison.groupSamples) };
      diffs = diffs.map((d, i) => {
        const r = pairs[i];
        return d && r ? { ...d, rankP: r.p, rankR: r.r } : d;
      });
    }
    const decided = decide(diffs, adjust);
    const opts: PhraseOptions = { rank: !!rank, adjust: !!adjust };
    const unit = comparison.compareKind === 'numeric' ? '' : ' 分';
    const parts = decided.map((d, i) => (d ? phrase(comparison.groups[i + 1].name, d, unit, opts) : null)).filter((p): p is string => p !== null);
    const anyClear = decided.some((d) => d?.clear);
    const method = [rank ? 'Mann–Whitney U 秩检验' : '', adjust ? `${CORRECTION_LABELS[adjust]} 校正` : ''].filter(Boolean).join('，');
    const head = `各组在「${comparison.compareTitle}」上的${rank ? '分布' : '均值'}${anyClear ? '存在差别' : '没有看到明确差别'}（相对基准组「${comparison.groups[0].name}」${method ? `，${method}` : ''}）：`;
    let sentence = comparison.groups.length < 2 ? '分组题只有一组有有效回答，无法比较差别。' : parts.length ? `${head}${parts.join('；')}。` : '各组的有效回答不足 2 条或取值完全相同，无法比较差别。';
    if (rank?.overall) sentence += `整体检验：Kruskal–Wallis H = ${formatNumber(rank.overall.h, 2)}，df = ${rank.overall.df}，p = ${formatP(rank.overall.p)}，ε² = ${formatNumber(rank.overall.epsilon2, 3)}。`;
    const m = decided.filter((d) => d && (d.rankP ?? d.p) !== null).length;
    return {
      ...comparison,
      rank,
      adjust: adjust ? { method: adjust, m } : null,
      rows: [{ ...row, diffs: decided, sentence: parts.length ? `${parts.join('；')}。` : '无法比较各组。' }],
      sentence,
    };
  }

  // 多选题：每个选项的卡方检验各自有一个 p，按选项数做校正；占比差仍按区间判断。
  if (adjust && comparison.multi) {
    const raw = comparison.rows.map((r) => r.test?.p ?? Number.NaN);
    const adjusted = adjustP(raw, adjust);
    const rows = comparison.rows.map((r, i) => (r.test ? { ...r, test: { ...r.test, pAdjusted: adjusted[i] } } : r));
    const sentence = comparison.sentence.replace('各选项分别检验，未做多重比较校正。', `各选项分别检验，p 值已按 ${CORRECTION_LABELS[adjust]} 校正。`);
    return { ...comparison, rows, sentence, adjust: { method: adjust, m: raw.filter((p) => !Number.isNaN(p)).length } };
  }
  return comparison;
}
