/* 缓动与插值。所有函数输入输出都在 [0,1]（除 lerp/remap）。
 *   wk.ease.sineInOut(x) / cubicOut / cubicInOut / quadIn / quadOut / expoOut / linear
 *   wk.clamp(x, a=0, b=1)  wk.lerp(a, b, t)  wk.remap(x, a, b, c, d)  wk.smoothstep(a, b, x)
 * 注意：wukong-animation 的多数风格禁止 overshoot（弹簧、回弹），这里刻意不提供 back / elastic。
 */
(function () {
  'use strict';
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  wk.clamp = clamp;
  wk.lerp = (a, b, t) => a + (b - a) * t;
  wk.remap = (x, a, b, c, d) => c + ((x - a) / (b - a)) * (d - c);
  wk.smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  wk.ease = {
    linear: (x) => x,
    sineIn: (x) => 1 - Math.cos((x * Math.PI) / 2),
    sineOut: (x) => Math.sin((x * Math.PI) / 2),
    sineInOut: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
    quadIn: (x) => x * x,
    quadOut: (x) => 1 - (1 - x) * (1 - x),
    cubicOut: (x) => 1 - Math.pow(1 - x, 3),
    cubicInOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    expoOut: (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  };
})();
