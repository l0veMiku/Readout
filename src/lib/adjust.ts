// 多重比较的 p 值校正，与 R 的 p.adjust 同一套算法。
export type CorrectionMethod = 'holm' | 'bh';

// NaN 不参与校正、原位保留，检验数 m 也只数有效的 p（R 的 p.adjust 同样如此）。不改动传入的数组。
export function adjustP(p: number[], method: CorrectionMethod): number[] {
  const out = new Array<number>(p.length).fill(NaN);
  const order: number[] = [];
  for (let i = 0; i < p.length; i++) if (!Number.isNaN(p[i])) order.push(i);
  const m = order.length;
  // 从小到大的下标；sort 是稳定的，并列的 p 保持原有顺序。
  order.sort((a, b) => p[a] - p[b]);
  if (method === 'holm') {
    // step-down：第 i 小的 p（从 1 数）乘以 m+1−i，再取累计最大值，使校正后的 p 随原始 p 单调不减。
    let sofar = -Infinity;
    order.forEach((i, rank) => {
      sofar = Math.max(sofar, (m - rank) * p[i]);
      out[i] = sofar;
    });
  } else {
    // step-up：第 i 小的 p 乘以 m/i，再从最大的 p 往回取累计最小值。先除后乘，与 R 的 n/i * p 同序。
    let sofar = Infinity;
    for (let rank = m - 1; rank >= 0; rank--) {
      sofar = Math.min(sofar, (m / (rank + 1)) * p[order[rank]]);
      out[order[rank]] = sofar;
    }
  }
  for (const i of order) out[i] = Math.min(1, Math.max(0, out[i]));
  return out;
}
