// s18 —— 月、雾、山石（碣石、远山）。大远景：右下斜月半沉入厚厚的海雾，左有碣石一点，右有远山一抹
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const b = s.cueOut('第34句');
    wk.ink.paper(ctx, s);
    ctx.save();
    ctx.translate(-0.006 * W * t, 0);
    wk.cj.layer(ctx, s, 's18:far', 1, (g) => {
      wk.cj.rock(g, { x: 0.12 * W, y: 0.62 * H, w: 60 * u, h: 46 * u, u, seed: 241, tone: P.dan });
      wk.ink.mountain(g, { x0: 0.55 * W, x1: 1.2 * W, y: 0.62 * H, amp: 60 * u, peaks: [[0.4, 60 * u, 0.25]], tone: P.qing, alpha: 0.45, line: 0, cun: 0, u, seed: 242 });
    }, 0.15);
    ctx.restore();
    const sink = wk.ease.sineInOut(wk.seg(t, 0, b));
    wk.cj.moon(ctx, { x: 0.78 * W, y: (0.56 + 0.06 * sink) * H, r: 46 * u });
    wk.ink.mist(ctx, { y: 0.66 * H, h: (110 + 60 * sink) * u, x0: -0.1 * W, x1: 1.1 * W, alpha: 0.9, t: s.gt, seed: 243 });
    wk.cj.layer(ctx, s, 's18:sea', 1, (g) => wk.cj.waves(g, { x0: 0.1 * W, x1: 0.9 * W, y: 0.82 * H, n: 3, gap: 16, u, seed: 244, tone: P.qing, alpha: 0.7 }));
    wk.cj.frame(ctx, t, s, { into: 'mist', out: 'mist' });
  },
});
