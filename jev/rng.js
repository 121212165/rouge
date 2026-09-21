/* 确定性随机：把散落在关卡生成、掉落、暴击、分裂里的 40 处 Math.random 收成一个可注入的种子源。
   单独成模块的理由：node 测试要能 import 它来验"同一个 seed 跑出同一局"，
   而游戏逻辑本身还在 index.html 内联脚本里，拿不到。这是无头规则层之前最小的一步。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Rng = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // 6 位 base36：够短，玩家愿意手抄，也够在一台设备上避免撞车。
  // 这里刻意用 Math.random 而不是本模块的 rng —— 它是种子的 bootstrap，
  // 早先用 Date.now() 取模，同一毫秒内多次调用会拿到同一个值。
  function newSeed() {
    let s = '';
    while (s.length < 6) s += Math.floor(Math.random() * 36).toString(36);
    return s;
  }
  function makeRng(seed) { return mulberry32(hashSeed(String(seed))); }
  return { mulberry32, hashSeed, makeRng, newSeed };
});
