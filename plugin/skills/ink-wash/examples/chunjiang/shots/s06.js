// s06 —— 月、水、雾。远景：江天一色，右上一轮孤月的晕慢慢晕开，下方一线极淡的江天交界
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const a = s.cueIn('第9句');
    wk.ink.paper(ctx, s);
    wk.cj.moon(ctx, { x: 0.7 * W, y: 0.26 * H, r: 52 * u, k: wk.seg(t, 0.5, a + 1.8) });
    wk.cj.layer(ctx, s, 's06:horizon', 1, (g) => {
      wk.ink.mountain(g, { x0: -0.05 * W, x1: 0.45 * W, y: 0.74 * H, amp: 46 * u, peaks: [[0.3, 50 * u, 0.25]], tone: P.qing, alpha: 0.4, line: 0, cun: 0, u, seed: 104 });
      wk.c2d.brush(g, [[-0.05 * W, 0.74 * H], [0.4 * W, 0.742 * H], [1.05 * W, 0.738 * H]], { width: 2 * u, color: P.qing, alpha: 0.8, dry: 0.7, taper: [0.2, 0.2], bristles: 6, seed: 101 });
      wk.cj.waves(g, { x0: 0.1 * W, x1: 0.9 * W, y: 0.8 * H, n: 4, gap: 14, u, seed: 102, tone: P.qing, alpha: 0.75 });
    });
    wk.ink.mist(ctx, { y: 0.74 * H, h: 50 * u, x0: -0.1 * W, x1: 1.1 * W, alpha: 0.5, t: s.gt, seed: 103 });
    wk.cj.frame(ctx, t, s, { into: 'mist', out: 'mist' });
  },
});
