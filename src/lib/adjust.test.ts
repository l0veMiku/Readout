import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjustP } from './adjust.ts';

// 基准来自仓库外的 R 脚本：sprintf("%.17g", p.adjust(p, method))。
const same = (actual: number[], expected: number[]) => {
  assert.equal(actual.length, expected.length, `长度 ${actual.length} 对 ${expected.length}`);
  expected.forEach((want, i) => {
    const got = actual[i];
    assert.ok((Number.isNaN(got) && Number.isNaN(want)) || Math.abs(got - want) <= 1e-12, `第 ${i + 1} 个：${got} 对 R 的 ${want}`);
  });
};

const P1 = [0.01, 0.04, 0.03, 0.5, 0.2];
// p.adjust(c(0.01, 0.04, 0.03, 0.5, 0.2), "holm")
const P1_HOLM = [0.050000000000000003, 0.12, 0.12, 0.5, 0.40000000000000002];
// p.adjust(c(0.01, 0.04, 0.03, 0.5, 0.2), "BH")
const P1_BH = [0.050000000000000003, 0.066666666666666666, 0.066666666666666666, 0.5, 0.25];

// 十个 p 值：两个 0.03、三个 0.2 并列，还有一个 1.0。
const P2 = [0.005, 0.03, 0.03, 0.12, 1.0, 0.0001, 0.2, 0.2, 0.2, 0.5];
// p.adjust(c(0.005, 0.03, 0.03, 0.12, 1.0, 0.0001, 0.2, 0.2, 0.2, 0.5), "holm")
const P2_HOLM = [0.044999999999999998, 0.23999999999999999, 0.23999999999999999, 0.71999999999999997, 1, 0.001, 1, 1, 1, 1];
// p.adjust(c(0.005, 0.03, 0.03, 0.12, 1.0, 0.0001, 0.2, 0.2, 0.2, 0.5), "BH")
const P2_BH = [0.025000000000000001, 0.074999999999999997, 0.074999999999999997, 0.23999999999999999, 1, 0.001, 0.25, 0.25, 0.25, 0.55555555555555558];

const METHODS = ['holm', 'bh'] as const;

test('Holm and BH match R p.adjust on five p values', () => {
  same(adjustP(P1, 'holm'), P1_HOLM);
  same(adjustP(P1, 'bh'), P1_BH);
});

test('ten p values with ties and a 1.0 match R; tied p values share one adjusted value', () => {
  for (const method of METHODS) {
    const out = adjustP(P2, method);
    same(out, method === 'holm' ? P2_HOLM : P2_BH);
    assert.equal(out[1], out[2], `${method}: 并列的 0.03 校正后不一样`);
    assert.equal(out[6], out[7], `${method}: 并列的 0.2 校正后不一样`);
    assert.equal(out[6], out[8], `${method}: 并列的 0.2 校正后不一样`);
    out.forEach((q, i) => assert.ok(q >= P2[i] - 1e-12 && q <= 1, `${method}: 第 ${i + 1} 个校正成了 ${q}`));
  }
});

test('NaN stays in place and is left out of the number of tests, as in R', () => {
  const p = [0.01, NaN, 0.03, NaN, 0.2];
  // p.adjust(c(0.01, NA, 0.03, NA, 0.2), "holm")
  same(adjustP(p, 'holm'), [0.029999999999999999, NaN, 0.059999999999999998, NaN, 0.20000000000000001]);
  // p.adjust(c(0.01, NA, 0.03, NA, 0.2), "BH")
  same(adjustP(p, 'bh'), [0.029999999999999999, NaN, 0.044999999999999998, NaN, 0.20000000000000001]);
});

test('results are capped at 1', () => {
  // p.adjust(c(0.6, 0.7, 0.9), "holm")
  same(adjustP([0.6, 0.7, 0.9], 'holm'), [1, 1, 1]);
  // p.adjust(c(0.6, 0.7, 0.9), "BH")
  same(adjustP([0.6, 0.7, 0.9], 'bh'), [0.90000000000000002, 0.90000000000000002, 0.90000000000000002]);
});

test('one p value comes back as it is, all-NaN stays all-NaN, and nothing in means nothing out', () => {
  // p.adjust(c(0.03), "holm") 与 p.adjust(c(0.03), "BH")
  same(adjustP([0.03], 'holm'), [0.03]);
  same(adjustP([0.03], 'bh'), [0.03]);
  for (const method of METHODS) {
    same(adjustP([NaN, NaN], method), [NaN, NaN]);
    assert.deepEqual(adjustP([], method), []);
  }
});

test('the input is left as it was and the result is a separate array', () => {
  const p = [0.03, 0.01, 0.2];
  const before = [...p];
  const out = adjustP(p, 'holm');
  assert.notEqual(out, p);
  assert.deepEqual(p, before);
  // p.adjust(c(0.03, 0.01, 0.2), "holm")
  same(out, [0.06, 0.03, 0.2]);
  // p.adjust(c(0.03, 0.01, 0.2), "BH")
  same(adjustP(p, 'bh'), [0.045, 0.03, 0.2]);
  assert.deepEqual(p, before);
});
