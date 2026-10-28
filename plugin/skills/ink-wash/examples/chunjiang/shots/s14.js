// s14 —— 楼（远）、扁舟、水、月、笔触（月华）。远景：左楼右舟隔着大片江水，一缕月华从月流向小楼
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const b = s.cueOut('第26句');
    wk.ink.paper(ctx, s);
    wk.cj.moon(ctx, { x: 0.6 * W, y: 0.16 * H, r: 34 * u });
    wk.cj.layer(ctx, s, 's14:scene', wk.seg(t, 0.6, 2.2), (g, k) => {
      g.save();
      g.globalAlpha *= wk.ease.sineInOut(k);
      wk.cj.pavilion(g, { x: 0.18 * W, y: 0.6 * H, w: 0.08 * W, u, seed: 191, tone: P.dan });
      wk.c2d.brush(g, [[0.08 * W, 0.61 * H], [0.3 * W, 0.605 * H]], { width: 3 * u, color: P.dan, alpha: 0.7, dry: 0.6, bristles: 6, seed: 192 });
      wk.cj.skiff(g, { x: 0.78 * W, y: 0.72 * H, L: 0.06 * W, u, seed: 193, tone: P.nong });
      wk.cj.waves(g, { x0: 0.3 * W, x1: 0.95 * W, y: 0.76 * H, n: 4, gap: 14, u, seed: 194, tone: P.qing, alpha: 0.8 });
      g.restore();
    });
    const flow = wk.seg(t, b - 4, b, 'sineInOut');
    const PATH = [[0.585 * W, 0.2 * H], [0.5 * W, 0.24 * H], [0.38 * W, 0.33 * H], [0.27 * W, 0.42 * H], [0.2 * W, 0.47 * H]];
    wk.c2d.brush(ctx, PATH, { width: 30 * u, color: P.qing, alpha: 0.32, progress: flow, dry: 0.85, bleed: 10 * u, taper: [0.3, 0.6], bristles: 16, seed: 195 });
    wk.c2d.brush(ctx, PATH.map(([x, y]) => [x, y + 14 * u]), { width: 14 * u, color: P.qing, alpha: 0.25, progress: wk.seg(t, b - 3.4, b, 'sineInOut'), dry: 0.9, bleed: 6 * u, taper: [0.4, 0.6], bristles: 10, seed: 196 });
    wk.cj.frame(ctx, t, s, { into: 'mist', out: 'ink' });
  },
});
