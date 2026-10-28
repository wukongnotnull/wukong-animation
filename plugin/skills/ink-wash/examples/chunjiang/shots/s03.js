// s03 —— 水、月。中景：江面局部，月光碎影由近及远写出，上方只露月的下缘
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const a = s.cueIn('第3句');
    const b = s.cueOut('第4句');
    wk.ink.paper(ctx, s);
    wk.cj.moon(ctx, { x: 0.62 * W, y: -0.06 * H, r: 150 * u });
    wk.cj.waves(ctx, { x0: 0.05 * W, x1: 0.95 * W, y: 0.27 * H, n: 3, gap: 10, u, seed: 51, tone: wk.ink.palette.qing, alpha: 0.7 });
    wk.cj.moonlight(ctx, { x: 0.62 * W, y0: 0.3 * H, y1: 1.02 * H, w0: 60 * u, w1: 760 * u, rows: 16, progress: wk.seg(t, a - 0.4, b, 'cubicOut'), t: s.gt, u, seed: 52 });
    wk.cj.frame(ctx, t, s, { into: 'ink', out: 'mist' });
  },
});
