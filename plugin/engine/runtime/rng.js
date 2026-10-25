/* 带种子的伪随机数（mulberry32）。同一种子 → 同一序列 → 每帧可复现。
 *   const r = wk.rng(42);
 *   r()            → [0,1)
 *   r.range(a,b)   → [a,b)
 *   r.int(a,b)     → [a,b] 整数
 *   r.pick(arr)    → 随机取一项
 *   r.gauss(m,sd)  → 正态分布
 *   r.fork(k)      → 派生一个独立子序列（不影响父序列）
 */
(function () {
  'use strict';
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  wk.rng = function (seed) {
    const base = seed >>> 0;
    const r = mulberry32(base);
    r.range = (a, b) => a + (b - a) * r();
    r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.gauss = (m = 0, sd = 1) => {
      const u = 1 - r();
      const v = r();
      return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    r.fork = (k) => wk.rng((base ^ wk.hashStr(String(k))) >>> 0);
    return r;
  };
})();
