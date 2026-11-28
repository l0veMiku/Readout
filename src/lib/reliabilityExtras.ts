import type { ProModeOptions, Question } from '../types.ts';
import type { Interval } from './intervals.ts';
import { scaleRange, scaleScore } from './reliability.ts';
import { alphaInterval } from './reliabilityInterval.ts';
import { bartlett, correlationMatrix, kmo, singleFactorOmega } from './factor.ts';

export interface ReliabilityExtras {
  // 参与计算的完整作答份数。
  n: number;
  alphaCI: Interval | null;
  kmo: number | null;
  bartlett: { chi2: number; df: number; p: number } | null;
  omega: number | null;
  // 算不出来的原因与可靠性提示。
  notes: string[];
}

// 题组量表子题在完整作答问卷上的得分列；反向题先按翻转范围折回去。不足两道题或没有完整作答时为 null。
export function completeColumns(items: Question[], rows: Record<string, string>[]): number[][] | null {
  const scale = items.filter((q) => q.type === 'scale');
  if (scale.length < 2) return null;
  const columns = scale.map((q) => rows.map((r) => scaleScore(r[q.id])));
  const range = scaleRange(columns);
  if (!range) return null;
  const flipped = columns.map((col, j) => col.map((v) => (v === null ? null : scale[j].reversed ? range.min + range.max - v : v)));
  const complete: number[][] = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const line = flipped.map((col) => col[ri]);
    if (line.every((v): v is number => v !== null)) complete.push(line);
  }
  if (complete.length === 0) return null;
  return scale.map((_, j) => complete.map((line) => line[j]));
}

// 专业模式下的信度扩展：α 的区间，以及 KMO、Bartlett、单因子 ω。专业模式没开或没启用相关项时为 null。
export function reliabilityExtras(items: Question[], rows: Record<string, string>[], pro: ProModeOptions): ReliabilityExtras | null {
  if (!pro.on || (!pro.alphaCI && !pro.factorCheck)) return null;
  const cols = completeColumns(items, rows);
  if (!cols) return null;
  const n = cols[0].length;
  const items_ = items.filter((q) => q.type === 'scale').length;
  const notes: string[] = [];
  const corr = pro.factorCheck ? correlationMatrix(cols) : null;
  if (pro.factorCheck && !corr) notes.push('题目取值没有变化，无法做因子前置检验');

  let alphaCI: Interval | null = null;
  let kmoValue: number | null = null;
  let bartlettResult: ReliabilityExtras['bartlett'] = null;
  let omega: number | null = null;
  if (pro.alphaCI) {
    alphaCI = alphaInterval(cols);
    if (!alphaCI) notes.push('完整作答不足 5 份，α 不给区间');
  }
  if (pro.factorCheck && corr) {
    if (items_ >= 3) {
      kmoValue = kmo(corr);
      omega = singleFactorOmega(corr);
    } else {
      notes.push('KMO 与 ω 需要三道以上量表子题');
    }
    bartlettResult = bartlett(corr, n);
    if (n < 5 * items_) notes.push('样本相对变量偏少（少于 5 倍），指标仅供参考');
    if (kmoValue !== null && kmoValue < 0.5) notes.push('KMO 低于 0.5，不适合做因子分析');
  }
  return { n, alphaCI, kmo: kmoValue, bartlett: bartlettResult, omega, notes };
}
