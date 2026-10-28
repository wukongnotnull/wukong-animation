// s17 —— 山石（两岸）、水、月。远景：江水向画外流去，水纹从左往右写出，月往右下斜沉
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const a = s.cueIn('第31句');
    const b = s.cueOut('第32句');
    wk.ink.paper(ctx, s);
    const sink = wk.ease.sineInOut(wk.seg(t, a, b));
    wk.cj.moon(ctx, { x: (0.8 + 0.02 * sink) * W, y: (0.42 + 0.05 * sink) * H, r: 40 * u });
    wk.cj.layer(ctx, s, 's17:banks', 1, (g) => {
      wk.ink.mountain(g, { x0: -0.05 * W, x1: 0.7 * W, y: 0.52 * H, amp: 60 * u, peaks: [[0.35, 70 * u, 0.25]], tone: P.qing, alpha: 0.5, line: 0, cun: 0, u, seed: 231 });
      wk.ink.mountain(g, { x0: -0.08 * W, x1: 0.38 * W, y: 0.82 * H, amp: 50 * u, tone: P.dan, alpha: 0.45, line: 0.6, cun: 0.5, u, seed: 232, taper: [0, 0.4] });
    });
    wk.cj.waves(ctx, { x0: 0.2 * W, x1: 1.05 * W, y: 0.6 * H, n: 6, gap: 12, progress: wk.seg(t, a - 0.5, a + 2.5), t: s.gt, u, seed: 233 });
    wk.ink.mist(ctx, { y: 0.55 * H, h: 40 * u, x0: 0.3 * W, x1: 1.1 * W, alpha: 0.5, t: s.gt, seed: 234 });
    wk.cj.frame(ctx, t, s, { into: 'mist', out: 'mist' });
  },
});
