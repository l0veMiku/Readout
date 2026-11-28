import { chisqCDF } from './intervals.ts';

// 相关矩阵：列是题目（长度相同的完整作答向量）；任何一列没有变化时返回 null。
export function correlationMatrix(cols: number[][]): number[][] | null {
  const k = cols.length;
  if (k < 2) return null;
  const n = cols[0]?.length ?? 0;
  if (n < 2 || cols.some((c) => c.length !== n)) return null;
  const means = cols.map((c) => c.reduce((s, v) => s + v, 0) / n);
  const sds = cols.map((c, i) => Math.sqrt(c.reduce((s, v) => s + (v - means[i]) ** 2, 0) / (n - 1)));
  if (sds.some((s) => !(s > 0))) return null;
  return cols.map((a, i) =>
    cols.map((b, j) => {
      if (i === j) return 1;
      let s = 0;
      for (let r = 0; r < n; r++) s += (a[r] - means[i]) * (b[r] - means[j]);
      return s / ((n - 1) * sds[i] * sds[j]);
    }),
  );
}

// 高斯–约当求逆（部分主元）；奇异时返回 null。
export function invertMatrix(m: number[][]): number[][] | null {
  const n = m.length;
  if (n === 0 || m.some((row) => row.length !== n)) return null;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const p = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}

// 行列式（LU 分解，部分主元）；奇异时返回 null。
function determinant(m: number[][]): number | null {
  const n = m.length;
  const a = m.map((row) => [...row]);
  let det = 1;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      det = -det;
    }
    det *= a[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = a[r][col] / a[col][col];
      for (let j = col; j < n; j++) a[r][j] -= factor * a[col][j];
    }
  }
  return det;
}

// 整体 KMO：偏相关越小越接近 1；< 0.5 通常认为不适合做因子分析。
export function kmo(corr: number[][]): number | null {
  const k = corr.length;
  if (k < 2) return null;
  const inv = invertMatrix(corr);
  if (!inv) return null;
  let r2 = 0;
  let p2 = 0;
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      r2 += corr[i][j] ** 2;
      const partial = -inv[i][j] / Math.sqrt(inv[i][i] * inv[j][j]);
      p2 += partial ** 2;
    }
  }
  const total = r2 + p2;
  return total > 0 ? r2 / total : null;
}

// Bartlett 球形检验：χ² = −[(n−1) − (2p+5)/6] · ln|R|，df = p(p−1)/2。
export function bartlett(corr: number[][], n: number): { chi2: number; df: number; p: number } | null {
  const k = corr.length;
  if (k < 2 || n <= k) return null;
  const det = determinant(corr);
  if (det === null || !(det > 0)) return null;
  const chi2 = -((n - 1) - (2 * k + 5) / 6) * Math.log(det);
  const df = (k * (k - 1)) / 2;
  return { chi2, df, p: 1 - chisqCDF(chi2, df) };
}

// 单因子 ω：以第一主成分载荷近似，ω = (Σλ)² / ((Σλ)² + Σ(1 − λ²))；依赖单因子假设。
export function singleFactorOmega(corr: number[][]): number | null {
  const k = corr.length;
  if (k < 2) return null;
  let v = new Array<number>(k).fill(1 / Math.sqrt(k));
  let lambda = 0;
  for (let iter = 0; iter < 1000; iter++) {
    const w = corr.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
    const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
    if (!(norm > 0)) return null;
    const next = w.map((x) => x / norm);
    const delta = next.reduce((s, x, i) => s + Math.abs(x - v[i]), 0);
    v = next;
    lambda = norm;
    if (delta < 1e-14) break;
  }
  if (v.reduce((s, x) => s + x, 0) < 0) v = v.map((x) => -x);
  const load = v.map((x) => Math.sqrt(Math.max(lambda, 0)) * x);
  const sum = load.reduce((s, x) => s + x, 0);
  const uniqueness = load.reduce((s, x) => s + (1 - x * x), 0);
  const denom = sum * sum + uniqueness;
  return denom > 0 ? (sum * sum) / denom : null;
}
