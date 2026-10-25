/* 时间轴工具：把"第几秒发生什么"写成纯函数。
 *   wk.seg(t, a, b, ease?)        → t 在 [a,b] 内的进度 0..1（可带缓动），区间外钳制
 *   wk.keys(t, [[t0,v0],[t1,v1],...], ease?) → 分段插值（数值或等长数组）
 *   wk.stagger(t, i, n, a, b, overlap=0.5, ease?) → 第 i 个元素在 [a,b] 内依次出现的进度
 *   wk.hold(t, a, b)              → t 是否在 [a,b) 内
 */
(function () {
  'use strict';
  const E = () => wk.ease;
  wk.seg = function (t, a, b, ease) {
    const x = wk.clamp((t - a) / (b - a));
    return ease ? (typeof ease === 'string' ? E()[ease](x) : ease(x)) : x;
  };
  wk.keys = function (t, frames, ease) {
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
      const [t1, v1] = frames[i];
      const [t0, v0] = frames[i - 1];
      if (t <= t1) {
        const k = wk.seg(t, t0, t1, ease);
        return Array.isArray(v0) ? v0.map((v, j) => v + (v1[j] - v) * k) : v0 + (v1 - v0) * k;
      }
    }
    return frames[frames.length - 1][1];
  };
  wk.stagger = function (t, i, n, a, b, overlap = 0.5, ease) {
    const span = (b - a) / (n - (n - 1) * overlap);
    const start = a + i * span * (1 - overlap);
    return wk.seg(t, start, start + span, ease);
  };
  wk.hold = (t, a, b) => t >= a && t < b;
})();
