/* 确定性随机的纯函数校验：不需要浏览器，也不需要游戏逻辑可 import ——
   这一层能单独测，正是"先做 seed、再谈无头规则层"的理由。 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Rng = require(path.join(__dirname, '..', 'jev', 'rng.js'));

test('同一个 seed 必须给出完全相同的序列', () => {
  const a = Rng.makeRng('hanba-10'); const b = Rng.makeRng('hanba-10');
  const sa = Array.from({ length: 200 }, a), sb = Array.from({ length: 200 }, b);
  assert.deepEqual(sa, sb, '同 seed 不同序列，重放就是假的');
});

test('不同 seed 的序列必须分叉', () => {
  const sa = Array.from({ length: 40 }, Rng.makeRng('seed-A'));
  const sb = Array.from({ length: 40 }, Rng.makeRng('seed-B'));
  assert.notDeepEqual(sa, sb);
});

test('输出落在 [0,1) 且分布粗看可用', () => {
  const r = Rng.makeRng('dist-check');
  const N = 20000; let lo = 1, hi = 0, buckets = new Array(10).fill(0);
  for (let i = 0; i < N; i++) { const v = r(); lo = Math.min(lo, v); hi = Math.max(hi, v); buckets[Math.floor(v * 10)]++; }
  assert.ok(lo >= 0 && hi < 1, `越界：[${lo}, ${hi}]`);
  for (const [i, n] of buckets.entries()) {
    assert.ok(n > N / 10 * 0.9 && n < N / 10 * 1.1, `第 ${i} 段偏斜：${n}`);
  }
});

test('hashSeed 对短字符串稳定且不散列成同一个值', () => {
  const WORDS = ['a', 'b', 'z', 'aa', 'ab', 'zz', '0', '9', '阴阳道', '旱魃'];
  const set = new Set();
  for (const w of WORDS) {
    const h = Rng.hashSeed(w);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, `${w} 散列越界`);
    set.add(h);
  }
  assert.equal(set.size, WORDS.length, '短种子撞车就没法区分对局');
});

test('newSeed 产出可手抄、可回填 URL 的短串', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const s = Rng.newSeed();
    assert.ok(/^[0-9a-z]{1,6}$/.test(s), `seed 不该需要转义：${s}`);
    seen.add(s);
  }
  assert.ok(seen.size > 400, `500 次只出 ${seen.size} 个不同 seed，撞车率太高`);
});
