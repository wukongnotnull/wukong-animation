/* 《寒江》全片共用一幅画：各镜头只传"画到哪一步"，镜头之间天然连续。
 * 构图：平远。远山、近岸在左上，大片江面留白，小舟在右下黄金分割点附近，题字落在右上。
 */
(function () {
  'use strict';
  const P = wk.ink.palette;
  const PAN_SPEED = 0.008; // 每秒画宽的 0.8%，像缓缓展开长卷
  const PAN_STOP = 8; // 第 8 秒（全片时间）停住，留给题字

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} s 镜头状态
   * @param {object} k 各元素进度 0..1：far 远山、mid 近岸、rock 墨石、ripples 水纹、boat 小舟、text 题字、seal 印章
   */
  function scene(ctx, s, k) {
    const { W, H, u } = s;
    wk.ink.paper(ctx, s);

    const pan = W * PAN_SPEED * Math.min(s.gt, PAN_STOP);
    const LW = Math.ceil(W * 1.2); // 图层比画面宽，横移时不露边

    ctx.save();
    ctx.translate(-pan, 0);

    if (k.far > 0) {
      const far = wk.c2d.cached(`hj:far:${W}x${H}`, LW, H, (g) =>
        wk.ink.mountain(g, { x0: -0.05 * W, x1: 0.8 * W, y: 0.44 * H, amp: 170 * u, peaks: [[0.3, 150 * u, 0.25], [0.62, 95 * u, 0.2]], tone: P.qing, alpha: 0.55, line: 0, cun: 0, u, seed: 3 })
      );
      ctx.globalAlpha = wk.ease.sineInOut(k.far);
      ctx.drawImage(far, 0, 0);
      ctx.globalAlpha = 1;
    }

    if (k.mid > 0) {
      const mid = wk.c2d.cached(`hj:mid:${W}x${H}`, LW, H, (g) =>
        wk.ink.mountain(g, { x0: -0.08 * W, x1: 0.4 * W, y: 0.55 * H, amp: 230 * u, peaks: [[0.35, 210 * u, 0.3]], tone: P.dan, alpha: 0.5, u, seed: 9, taper: [0, 0.3] })
      );
      ctx.globalAlpha = wk.ease.sineInOut(k.mid);
      ctx.drawImage(mid, 0, 0);
      ctx.globalAlpha = 1;
    }

    wk.ink.mist(ctx, { y: 0.52 * H, h: 70 * u, x0: -0.1 * W, x1: 1.3 * W, alpha: 0.75, t: s.gt, seed: 4 });

    if (k.rock > 0) {
      wk.ink.drop(ctx, { x: 0.33 * W, y: 0.57 * H, r: wk.ease.cubicOut(k.rock) * 46 * u, density: 0.85, seed: 2 });
    }

    if (k.ripples > 0) {
      wk.ink.ripples(ctx, { x: 0.7 * W, y: 0.79 * H, w: 300 * u, n: 4, progress: k.ripples, t: s.gt, u, seed: 6 });
    }

    if (k.boat > 0) {
      const bob = Math.sin(s.gt * 0.9) * 2 * u;
      wk.ink.boat(ctx, { x: 0.68 * W, y: 0.75 * H + bob, size: 0.9, progress: k.boat, u, seed: 5 });
    }
    ctx.restore();

    // 题字与印章写在画框坐标里（此时横移已停）
    const size = 62 * u;
    const tx = 0.9 * W;
    const ty = 0.16 * H;
    if (k.text > 0) wk.ink.inscribe(ctx, '孤舟蓑笠翁', { x: tx, y: ty, size, progress: k.text });
    if (k.seal > 0) wk.ink.seal(ctx, { x: tx, y: ty + size * 5.6 + 40 * u, size: 54 * u, text: '寒江', progress: k.seal, seed: 8 });
  }

  wk.hj = { scene };
})();
