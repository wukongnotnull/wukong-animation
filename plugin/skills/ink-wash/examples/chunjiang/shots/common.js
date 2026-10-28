/* 《春江花月夜》镜头公共件：转场（雾遮 / 墨晕）、写完缓存的图层、每镜的进出场。
 * 全片 20 镜各是一幅画，镜头之间都换画：雾遮（STYLE.md 转场表）、墨晕（同上）。
 * 接缝两边画面相同：雾遮两边都是纯纸面；墨晕两边都是纸面上同一块淡墨晕。
 */
(function () {
  'use strict';
  const C = wk.c2d;
  const P = wk.ink.palette;
  const cj = (wk.cj = wk.cj || {});
  const IN = 0.8; // 进场：雾 / 墨晕散开用时
  const OUT = 0.7; // 出场：雾 / 墨晕漫过用时

  /** 雾遮：k = 0 不遮，k = 1 整片纸面。先漫过一层雾带，再整片铺满（同《寒江》）。 */
  function veil(ctx, s, k) {
    if (k <= 0) return;
    const { W, H, u } = s;
    ctx.save();
    ctx.globalAlpha = wk.clamp(k * 1.6, 0, 1);
    wk.ink.mist(ctx, { y: 0.5 * H, h: 260 * u, x0: -0.2 * W, x1: 1.2 * W, alpha: 0.9, t: s.gt, seed: 14 });
    ctx.globalAlpha = wk.ease.sineInOut(k);
    wk.ink.paper(ctx, s);
    ctx.restore();
  }

  /** 墨晕：画面淡成纸面的同时，正中一块淡墨晕开；k = 1 时只剩纸面和这块墨晕。 */
  function bloom(ctx, s, k) {
    if (k <= 0) return;
    const { W, H } = s;
    ctx.save();
    ctx.globalAlpha = wk.ease.sineInOut(k);
    wk.ink.paper(ctx, s);
    ctx.restore();
    const r = (0.08 + 0.3 * wk.ease.cubicOut(k)) * H;
    wk.ink.drop(ctx, { x: 0.5 * W, y: 0.5 * H, r, density: 0.32 * wk.ease.sineInOut(k), color: P.qing, seed: 31 });
  }

  const TRANSITIONS = { mist: veil, ink: bloom };

  /**
   * 进出场：into 是进入本镜的转场，out 是进入下一镜的转场（与下一镜的 into 相同）。
   * 第一镜没有 into；末镜用 out: 'fade' 极慢淡成纸面。
   */
  cj.frame = function (ctx, t, s, { into, out, fade = 2 }) {
    if (into) TRANSITIONS[into](ctx, s, 1 - wk.seg(t, 0, IN));
    if (out === 'fade') {
      const k = wk.seg(t, s.T - fade, s.T, 'sineInOut');
      if (k > 0) {
        ctx.save();
        ctx.globalAlpha = k;
        wk.ink.paper(ctx, s);
        ctx.restore();
      }
    } else if (out) {
      TRANSITIONS[out](ctx, s, wk.seg(t, s.T - OUT, s.T));
    }
  };

  /**
   * 写完就不再变的元素：k < 1 时直接画，k = 1 时缓存成图层（multiply 叠到纸上）。
   * pad 是图层比画面宽出的比例，镜头横移时不露边。draw(g, k) 在图层坐标里画。
   */
  cj.layer = function (ctx, s, key, k, draw, pad = 0) {
    if (k <= 0) return;
    if (k < 1) return draw(ctx, k);
    const img = C.cached(`cj:${key}:${s.W}x${s.H}`, Math.ceil(s.W * (1 + pad)), s.H, (g) => draw(g, 1));
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  };
})();
