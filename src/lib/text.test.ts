import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeHtml, formatCI, formatRange } from './text.ts';

test('escapeHtml neutralizes markup from survey labels', () => {
  const payload = `<img src=x onerror="window.__leak=sessionStorage.getItem('readout.key')">`;
  const escaped = escapeHtml(payload);
  assert.equal(escaped, '&lt;img src=x onerror=&quot;window.__leak=sessionStorage.getItem(&#39;readout.key&#39;)&quot;&gt;');
  assert.doesNotMatch(escaped, /<[a-z]/i);
  assert.equal(escapeHtml('A & B < C > D "E" \'F\''), 'A &amp; B &lt; C &gt; D &quot;E&quot; &#39;F&#39;');
});

test('negative bounds are separated with 至 so no double dash appears', () => {
  const f = (x: number) => x.toFixed(2);
  assert.equal(formatRange(1.4, 2.9, f), '1.40–2.90');
  assert.equal(formatRange(-1.9, 0.17, f), '-1.90 至 0.17');
  assert.equal(formatRange(-2.794, -1.812, f), '-2.79 至 -1.81');
  assert.equal(formatCI({ lower: -1.9, upper: 0.17 }, 2), '-1.90 至 0.17');
  assert.equal(formatCI({ lower: 0.1, upper: 0.4 }, 1), '0.1–0.4');
});