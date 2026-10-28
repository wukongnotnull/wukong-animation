// s02 —— 山石（远岸）、水、雾、月。远景：平远江海，潮纹逐笔写出，月从潮线上升起
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const HORIZON = 0.6 * H;
    const a = s.cueIn('第1句');
    const b = s.cueOut('第2句');
    wk.ink.paper(ctx, s);
    ctx.save();
    ctx.translate(-0.006 * W * t, 0);
    wk.cj.layer(ctx, s, 's02:shore', wk.seg(t, 0.3, 1.6), (g, k) => {
      g.save();
      g.globalAlpha *= wk.ease.sineInOut(k);
      wk.ink.mountain(g, { x0: -0.05 * W, x1: 1.25 * W, y: HORIZON, amp: 34 * u, peaks: [[0.7, 30 * u, 0.2]], tone: P.qing, alpha: 0.45, line: 0, cun: 0, u, seed: 41, taper: [0.05, 0.1] });
      g.restore();
    }, 0.2);
    ctx.restore();
    // 月不随画面横移（远处的东西不动），被潮线以下遮住，慢慢升起
    const rise = wk.ease.sineInOut(wk.seg(t, a - 0.3, b + 0.3));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, HORIZON);
    ctx.clip();
    wk.cj.moon(ctx, { x: 0.36 * W, y: HORIZON + 50 * u - rise * 0.14 * H, r: 46 * u, k: wk.seg(t, 0.4, 1.2) });
    ctx.restore();
    wk.cj.moonlight(ctx, { x: 0.36 * W, y0: HORIZON + 12 * u, y1: 0.8 * H, w0: 30 * u, w1: 200 * u, rows: 8, progress: rise * 0.6, t: s.gt, u, seed: 42, alpha: 0.5 });
    ctx.save();
    ctx.translate(-0.006 * W * t, 0);
    wk.cj.waves(ctx, { x0: -0.1 * W, x1: 1.3 * W, y: 0.67 * H, n: 6, gap: 16, progress: wk.seg(t, a - 0.6, a + 2.6), t: s.gt, u, seed: 43 });
    ctx.restore();
    wk.ink.mist(ctx, { y: HORIZON + 6 * u, h: 36 * u, x0: -0.1 * W, x1: 1.1 * W, alpha: 0.55, t: s.gt, seed: 44 });
    wk.cj.frame(ctx, t, s, { into: 'mist', out: 'ink' });
  },
});
