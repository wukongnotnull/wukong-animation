// s09 —— 山石（两岸）、水、月。大远景：长江横贯流向左侧画外，水纹从右往左写出
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const a = s.cueIn('第15句');
    wk.ink.paper(ctx, s);
    wk.cj.moon(ctx, { x: 0.82 * W, y: 0.15 * H, r: 22 * u });
    ctx.save();
    ctx.translate(-0.01 * W * t, 0);
    wk.cj.layer(ctx, s, 's09:banks', 1, (g) => {
      wk.ink.mountain(g, { x0: -0.05 * W, x1: 1.2 * W, y: 0.48 * H, amp: 40 * u, peaks: [[0.3, 50 * u, 0.2], [0.75, 30 * u, 0.15]], tone: P.qing, alpha: 0.5, line: 0, cun: 0, u, seed: 131 });
      wk.cj.washIn(g, 1, [[-0.05 * W, 0.62 * H], [0.5 * W, 0.6 * H], [1.2 * W, 0.63 * H], [1.2 * W, 0.72 * H], [-0.05 * W, 0.72 * H]], { color: P.qing, alpha: 0.4, blur: 10 * u, edge: 0.2, fade: [0.62 * H, 0.72 * H] });
    }, 0.2);
    wk.cj.waves(ctx, { x0: -0.05 * W, x1: 1.2 * W, y: 0.52 * H, n: 5, gap: 9, progress: wk.seg(t, a - 2.5, a + 2), t: s.gt, u, seed: 132, rtl: true });
    ctx.restore();
    wk.cj.frame(ctx, t, s, { into: 'mist', out: 'mist' });
  },
});
