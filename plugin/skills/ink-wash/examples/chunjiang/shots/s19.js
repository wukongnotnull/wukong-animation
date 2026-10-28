// s19 —— 树（江树）、月、雾、题字。远景：左侧一排江树树冠轻摇，月只剩右下雾里一抹；第 36 句时右上题字逐字跟人声写出
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    wk.ink.paper(ctx, s);
    wk.cj.moon(ctx, { x: 0.82 * W, y: 0.68 * H, r: 36 * u, k: 0.6 });
    wk.ink.mist(ctx, { y: 0.71 * H, h: 70 * u, x0: 0.55 * W, x1: 1.1 * W, alpha: 0.85, t: s.gt, seed: 251 });
    wk.cj.layer(ctx, s, 's19:bank', 1, (g) => wk.c2d.brush(g, [[-0.02 * W, 0.9 * H], [0.25 * W, 0.885 * H], [0.5 * W, 0.9 * H]], { width: 5 * u, color: P.dan, alpha: 0.8, dry: 0.6, taper: [0.1, 0.4], bristles: 8, seed: 252 }));
    const TREES = [[0.05, 0.42, 0.04], [0.13, 0.5, -0.03], [0.22, 0.38, 0.06], [0.3, 0.45, -0.05], [0.38, 0.32, 0.03]];
    TREES.forEach(([x, h, lean], i) => {
      const sway = Math.sin(s.gt * 0.8 + i * 1.3) * 0.004 * W;
      wk.cj.tree(ctx, { x: x * W, y: 0.9 * H, h: h * H, lean, u, seed: 253 + i, tone: P.zhong, crown: 'wash', crownTone: P.qing, sway });
    });
    // 题字逐字跟着第 36 句写出（逐字同步点由 wka soundtrack 按人声实测写入）
    const LAST = '落月摇情满江树';
    const chars = s.cueChars('第36句');
    const size = 64 * u;
    const step = size * 1.12;
    [...LAST].forEach((ch, i) => {
      if (chars[i]) wk.ink.inscribe(ctx, ch, { x: 0.88 * W, y: 0.1 * H + i * step, size, progress: wk.seg(t, chars[i].in, chars[i].out) });
    });
    wk.cj.frame(ctx, t, s, { into: 'mist', out: 'ink' });
  },
});
