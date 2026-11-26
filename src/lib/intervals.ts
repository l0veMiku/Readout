export interface Interval {
  lower: number;
  upper: number;
}

const Z975 = 1.959963984540054;
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const shifted = x - 1;
  const t = shifted + 7.5;
  let sum = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i++) sum += LANCZOS[i] / (shifted + i);
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
}

function betaContinuedFraction(a: number, b: number, x: number) {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-300) d = 1e-300;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-16) break;
  }
  return h;
}

export function betaCDF(x: number, a: number, b: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betaContinuedFraction(a, b, x)) / a;
  return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

// 正则化下不完全伽马函数 P(a, x)
export function gammaCDF(a: number, x: number) {
  if (x <= 0) return 0;
  const logFront = -x + a * Math.log(x) - logGamma(a);
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let delta = sum;
    for (let n = 1; n <= 500; n++) {
      ap += 1;
      delta *= x / ap;
      sum += delta;
      if (Math.abs(delta) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(logFront);
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return 1 - Math.exp(logFront) * h;
}

export function tCDF(x: number, df: number) {
  if (x === 0) return 0.5;
  const tail = 0.5 * betaCDF(df / (df + x * x), df / 2, 0.5);
  return x > 0 ? 1 - tail : tail;
}

export function tQuantile(p: number, df: number) {
  let lo = 0;
  let hi = 1;
  while (tCDF(hi, df) < p) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (tCDF(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function chisqCDF(x: number, df: number) {
  return gammaCDF(df / 2, x / 2);
}

export function wilsonInterval(k: number, n: number): Interval {
  if (n <= 0) return { lower: 0, upper: 0 };
  const p = k / n;
  const z2 = Z975 * Z975;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (Z975 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

export function meanInterval(xs: number[]): Interval | null {
  if (xs.length < 2) return null;
  const mu = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1));
  const half = (tQuantile(0.975, xs.length - 1) * sd) / Math.sqrt(xs.length);
  return { lower: mu - half, upper: mu + half };
}

// 5000 行以上每次重抽样的代价高，而此时端点的蒙特卡洛误差已经很小，减到 500 次换取速度。
const BOOT_REPS = 2000;
const BOOT_REPS_LARGE = 500;
const BOOT_LARGE_N = 5000;
const BOOT_SEED = 20261126;

export function bootstrapReps(n: number) {
  return n > BOOT_LARGE_N ? BOOT_REPS_LARGE : BOOT_REPS;
}

function type7Quantile(sorted: ArrayLike<number>, p: number) {
  const h = (sorted.length - 1) * p;
  const i = Math.floor(h);
  return i + 1 >= sorted.length ? sorted[i] : sorted[i] + (h - i) * (sorted[i + 1] - sorted[i]);
}

export interface BootIntervals {
  mean: Interval | null;
  median: Interval | null;
}

// 均值和中位数共用同一批重抽样；固定种子保证同一份数据每次得到同一个区间。
export function bootstrapIntervals(xs: number[]): BootIntervals {
  const none: BootIntervals = { mean: null, median: null };
  const n = xs.length;
  if (n < 2) return none;

  const reps = bootstrapReps(n);
  const sorted = Float64Array.from(xs).sort();
  const counts = new Uint32Array(n);
  const means = new Float64Array(reps);
  const medians = new Float64Array(reps);
  let state = BOOT_SEED >>> 0;
  const k = (n - 1) / 2;
  const lo = Math.floor(k);
  const frac = k - lo;

  for (let r = 0; r < reps; r++) {
    counts.fill(0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const idx = ((((t ^ (t >>> 14)) >>> 0) * n) / 4294967296) | 0;
      counts[idx]++;
      sum += sorted[idx];
    }
    means[r] = sum / n;

    let cum = 0;
    let first = NaN;
    let second = NaN;
    for (let i = 0; i < n; i++) {
      if (counts[i] === 0) continue;
      cum += counts[i];
      if (Number.isNaN(first)) {
        if (cum <= lo) continue;
        first = sorted[i];
        if (frac === 0) break;
      }
      if (cum > lo + 1) {
        second = sorted[i];
        break;
      }
    }
    medians[r] = frac === 0 ? first : first + frac * (second - first);
  }

  const meanBounds = Float64Array.from(means).sort();
  const medianBounds = Float64Array.from(medians).sort();
  return {
    mean: { lower: type7Quantile(meanBounds, 0.025), upper: type7Quantile(meanBounds, 0.975) },
    median: { lower: type7Quantile(medianBounds, 0.025), upper: type7Quantile(medianBounds, 0.975) },
  };
}
