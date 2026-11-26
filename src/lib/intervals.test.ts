import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hours, scaleA, skew } from './refdata.ts';
import { betaCDF, bootstrapIntervals, chisqCDF, gammaCDF, logGamma, meanInterval, tCDF, tQuantile, wilsonInterval } from './intervals.ts';

const close = (actual: number | null | undefined, expected: number, tol = 1e-9) => {
  assert.ok(actual !== null && actual !== undefined, `expected ${expected}, got nothing`);
  assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${actual} vs R ${expected}`);
};

test('log-gamma, incomplete beta and incomplete gamma match known values', () => {
  close(logGamma(0.5), Math.log(Math.sqrt(Math.PI)));
  close(logGamma(1), 0);
  close(logGamma(12.5), 18.734347511936448);
  close(logGamma(50000.5), 490989.83315821405, 1e-10);
  close(betaCDF(0.3, 2, 3), 0.3483);
  close(betaCDF(0.9, 0.5, 0.5), 0.79516723530086664);
  close(gammaCDF(0.5, 0.5), 0.682689492137086);
  close(gammaCDF(3.5, 2.5), 0.34003677030571727);
  close(gammaCDF(10, 3), 0.0011024881301154794);
});

test('t quantile matches R qt(0.975, df) to 1e-9', () => {
  const cases: [number, number][] = [
    [1, 12.7062047361747], [1.5, 6.01666310442793], [2, 4.30265272974946], [3, 3.18244630528371], [4.5, 2.6589123472044],
    [5, 2.57058183563631], [10, 2.22813885198627], [12.34, 2.17217329680978], [25.7, 2.05669787885627], [30, 2.04227245630124],
    [100, 1.98397151852355], [1000.5, 1.96233789245935], [100000, 1.95998770753461],
  ];
  for (const [df, q] of cases) close(tQuantile(0.975, df), q);
});

test('t and chi-square distribution functions match R pt and pchisq', () => {
  const pt: [number, number, number][] = [
    [-6, 1, 0.0525684567112534], [-2.5, 1, 0.121118941590843], [-1, 1, 0.25], [-0.3, 1, 0.407226420922258], [0.5, 1, 0.647583617650433],
    [1.3, 1, 0.791285599839847], [2.8, 1, 0.890812088566371], [5, 1, 0.937167041810999],
    [-6, 2.5, 0.00764086494276145], [-2.5, 2.5, 0.0522849815390777], [-1, 2.5, 0.202030513639137], [-0.3, 2.5, 0.393671185747599],
    [0.5, 2.5, 0.671151040065143], [1.3, 2.5, 0.849756605364646], [2.8, 2.5, 0.958210681933494], [5, 2.5, 0.988274405014569],
    [-6, 7, 0.000271129171001405], [-2.5, 7, 0.0204961092928764], [-1, 7, 0.175308331410104], [-0.3, 7, 0.386445025201067],
    [0.5, 7, 0.683796432155358], [1.3, 7, 0.882616082303811], [2.8, 7, 0.986737874509946], [5, 7, 0.999217361023414],
    [-6, 23.3, 1.92325238047874e-06], [-2.5, 23.3, 0.00994443483303908], [-1, 23.3, 0.163791653048452], [-0.3, 23.3, 0.383418662039862],
    [0.5, 23.3, 0.689117724504909], [1.3, 23.3, 0.896842518719707], [2.8, 23.3, 0.994952323703452], [5, 23.3, 0.999977485489743],
    [-6, 120, 1.07415190965302e-08], [-2.5, 120, 0.0068847674625152], [-1, 120, 0.159661361932211], [-0.3, 120, 0.382348105587593],
    [0.5, 120, 0.691004637830801], [1.3, 120, 0.901953761120457], [2.8, 120, 0.99702125822305], [5, 120, 0.99999901090471],
  ];
  for (const [x, df, p] of pt) assert.ok(Math.abs(tCDF(x, df) - p) <= 1e-12 + Math.abs(p) * 1e-6, `pt(${x}, ${df}) = ${tCDF(x, df)} vs R ${p}`);
  assert.equal(tCDF(0, 9), 0.5);

  const pchisq: [number, number, number][] = [
    [0, 1, 0], [0.5, 1, 0.520499877813047], [1, 1, 0.682689492137086], [3.84, 1, 0.949956478751295], [10.2, 1, 0.998595593462469],
    [30, 1, 0.999999956795369], [80, 1, 1], [0.5, 2, 0.221199216928595], [1, 2, 0.393469340287367], [3.84, 2, 0.85339303786965],
    [10.2, 2, 0.993903253434484], [30, 2, 0.99999969409768], [80, 2, 1], [0.5, 3.5, 0.0469639788304382], [1, 3.5, 0.135531503618417],
    [3.84, 3.5, 0.646982936198788], [10.2, 3.5, 0.974310107685612], [30, 3.5, 0.999997338197614], [80, 3.5, 1], [0.5, 5, 0.00787670676737041],
    [1, 5, 0.0374342267527036], [3.84, 5, 0.427325540167911], [10.2, 5, 0.930237338728457], [30, 5, 0.999985251418962], [80, 5, 1],
    [0.5, 10, 6.61171056103425e-06], [1, 10, 0.000172115629955841], [3.84, 10, 0.0457236956792642], [10.2, 10, 0.576874585581401],
    [30, 10, 0.999143358789225], [80, 10, 0.999999999999498], [0.5, 23.7, 1.77566260798415e-16], [1, 23.7, 5.20783613333903e-13],
    [3.84, 23.7, 1.19250738536884e-06], [10.2, 23.7, 0.00727972905124765], [30, 23.7, 0.826306641225237], [80, 23.7, 0.999999949826847],
  ];
  for (const [x, df, p] of pchisq) assert.ok(Math.abs(chisqCDF(x, df) - p) <= 1e-12 + Math.abs(p) * 1e-6, `pchisq(${x}, ${df}) = ${chisqCDF(x, df)} vs R ${p}`);
});

test('Wilson interval matches R prop.test(correct = FALSE)', () => {
  const cases: [number, number, number, number][] = [
    [42, 128, 0.252829844716633, 0.413435984002385], [8, 10, 0.490162471536642, 0.943317848545625], [10, 10, 0.722467200137111, 1],
    [0, 12, 0, 0.242494006655241], [1, 50, 0.00353925927164624, 0.104954435896378], [3, 7, 0.15821985525147, 0.749541635472343],
    [500, 1000, 0.469069600368104, 0.530930399631896], [7, 300, 0.0113476602991252, 0.0473719722682753],
    [2, 3, 0.207659600802048, 0.938508055279604], [23, 25, 0.750338910496047, 0.977779598715153], [96, 97, 0.943895009757101, 0.998177835191713],
  ];
  for (const [k, n, lower, upper] of cases) {
    const ci = wilsonInterval(k, n);
    close(ci.lower, lower);
    close(ci.upper, upper);
  }
  assert.equal(scaleA.length, 128);
  assert.equal(skew.length, 116);
  assert.equal(hours.length, 300);
});

test('t interval for the mean matches R t.test', () => {
  const cases: [number[], number, number, number][] = [
    [scaleA, 3.171875, 2.95336480215034, 3.39038519784966],
    [[3, 5, 4], 4, 1.51586228824967, 6.48413771175033],
    [skew, 3.79310344827586, 1.21015973390219, 6.37604716264954],
    [hours, 5.43133333333333, 5.0158168423552, 5.84684982431146],
    [[2, 4], 3, -9.70620473617469, 15.7062047361747],
  ];
  for (const [xs, mu, lower, upper] of cases) {
    const ci = meanInterval(xs);
    assert.ok(ci);
    close((ci.lower + ci.upper) / 2, mu);
    close(ci.lower, lower);
    close(ci.upper, upper);
  }
  assert.deepEqual(meanInterval([5]), null);
  assert.deepEqual(meanInterval([]), null);
  const flat = meanInterval([4, 4, 4]);
  assert.ok(flat && flat.lower === 4 && flat.upper === 4);
});

test('bootstrap percentile interval agrees with a 200000-replicate R target', () => {
  // 容差取 R 端 200 次 2000 重抽样得到的端点标准差（4 倍以上留出偶然失败的空间）。
  const cases: { xs: number[]; lower: number; upper: number; loSd: number; hiSd: number }[] = [
    { xs: skew, lower: 1.73275862068966, upper: 6.71551724137931, loSd: 0.0355043552702192, hiSd: 0.112684802496739 },
    { xs: hours, lower: 5.02, upper: 5.84700833333333, loSd: 0.0126800871732125, hiSd: 0.0115473327249538 },
    { xs: scaleA, lower: 2.953125, upper: 3.3828125, loSd: 0.03, hiSd: 0.03 },
  ];
  for (const c of cases) {
    const ci = bootstrapIntervals(c.xs).mean;
    assert.ok(ci);
    assert.ok(Math.abs(ci.lower - c.lower) <= Math.max(5 * c.loSd, 0.02), `mean lower ${ci.lower} vs R ${c.lower}`);
    assert.ok(Math.abs(ci.upper - c.upper) <= Math.max(5 * c.hiSd, 0.02), `mean upper ${ci.upper} vs R ${c.upper}`);
  }
  const skewMedian = bootstrapIntervals(skew).median;
  assert.ok(skewMedian);
  assert.ok(Math.abs(skewMedian.lower - 0) <= 0.02 && Math.abs(skewMedian.upper - 1.5) <= 5 * 0.24287425628415, `${skewMedian.lower}–${skewMedian.upper}`);
  const hoursMedian = bootstrapIntervals(hours).median;
  assert.ok(hoursMedian);
  assert.ok(Math.abs(hoursMedian.lower - 4.9) <= 5 * 0.02116393300645 && Math.abs(hoursMedian.upper - 5.8) <= 5 * 0.00925612658713069, `${hoursMedian.lower}–${hoursMedian.upper}`);

  assert.deepEqual(bootstrapIntervals([3]), { mean: null, median: null });
  const same = bootstrapIntervals(skew);
  assert.deepEqual(same, bootstrapIntervals(skew));
  assert.deepEqual(bootstrapIntervals([0, 1]), { mean: { lower: 0, upper: 1 }, median: { lower: 0, upper: 1 } });
});
