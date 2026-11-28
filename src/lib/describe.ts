// 一个变量的分布形态：偏度和峰度（超额峰度，正态分布为 0）以及它们在正态假定下的标准误。
export interface Shape {
  n: number;
  skew: number;
  kurtosis: number;
  skewSE: number;
  kurtosisSE: number;
  // 超出 Q1−3×IQR 至 Q3+3×IQR 的极端值；没有时为 null。
  outliers: { n: number; min: number; max: number } | null;
}

// 偏度 g1、峰度 g2 用 type 2 公式（SAS、SPSS 和 e1071 的默认口径）：先按样本标准差（n−1）标准化，再对 z 求和。
// 样本不足 4 个、取值完全相同（标准差为 0）或者数据里有 NaN、无穷时没有定义，返回 null。
function skewAndKurtosis(xs: number[]): { n: number; skew: number; kurtosis: number } | null {
  const n = xs.length;
  if (n < 4) return null;
  const mu = xs.reduce((s, x) => s + x, 0) / n;
  let ss = 0;
  let c3 = 0;
  let c4 = 0;
  for (const x of xs) {
    const d = x - mu;
    const d2 = d * d;
    ss += d2;
    c3 += d2 * d;
    c4 += d2 * d2;
  }
  const s = Math.sqrt(ss / (n - 1));
  if (!Number.isFinite(s) || s === 0) return null;
  // 中心矩除以 s 的幂就是 z 的矩之和；前面的系数是 type 2 的偏差校正。
  return {
    n,
    skew: (n / ((n - 1) * (n - 2))) * (c3 / s ** 3),
    kurtosis: ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * (c4 / s ** 4) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3)),
  };
}

// 偏度 g1：大于 0 右偏（长尾在右），小于 0 左偏。
export function skewness(xs: number[]): number | null {
  const m = skewAndKurtosis(xs);
  return m === null ? null : m.skew;
}

// 峰度 g2：大于 0 比正态分布更尖、尾部更厚。
export function kurtosis(xs: number[]): number | null {
  const m = skewAndKurtosis(xs);
  return m === null ? null : m.kurtosis;
}

// 偏度、峰度各自除以标准误（sqrt(6/n)、sqrt(24/n)）的绝对值超过 2，就可以认为明显偏离正态。
// 不足 8 个观测时这两个估计太不稳定，不给出形态。
export function distributionShape(xs: number[]): Shape | null {
  const m = skewAndKurtosis(xs);
  if (m === null || m.n < 8) return null;
  const n = m.n;
  const sorted = [...xs].sort((a, b) => a - b);
  const q = (p: number) => {
    const h = (n - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.min(lo + 1, n - 1);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const low = q1 - 3 * iqr;
  const high = q3 + 3 * iqr;
  const extreme = iqr > 0 ? xs.filter((x) => x < low || x > high).length : 0;
  return {
    n,
    skew: m.skew,
    kurtosis: m.kurtosis,
    skewSE: Math.sqrt(6 / n),
    kurtosisSE: Math.sqrt(24 / n),
    outliers: extreme > 0 ? { n: extreme, min: sorted[0], max: sorted[n - 1] } : null,
  };
}
