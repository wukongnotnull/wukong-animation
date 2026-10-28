// s12 —— 楼、树、月。全景：明月楼逐笔写出，楼前一株树，月沿楼檐横移一小段（徘徊）
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const a = s.cueIn('第21句');
    const b = s.cueOut('第22句');
    wk.ink.paper(ctx, s);
    const drift = wk.ease.sineInOut(wk.seg(t, a, b));
    wk.cj.moon(ctx, { x: (0.42 + 0.08 * drift) * W, y: 0.2 * H, r: 44 * u });
    wk.cj.layer(ctx, s, 's12:ground', 1, (g) => wk.c2d.brush(g, [[0.45 * W, 0.83 * H], [0.7 * W, 0.825 * H], [0.98 * W, 0.83 * H]], { width: 4 * u, color: P.dan, alpha: 0.8, dry: 0.6, taper: [0.2, 0.3], bristles: 8, seed: 171 }));
    wk.cj.layer(ctx, s, 's12:pavilion', wk.seg(t, 0.5, a + 2.5), (g, k) => wk.cj.pavilion(g, { x: 0.72 * W, y: 0.82 * H, w: 0.24 * W, progress: k, u, seed: 172 }));
    wk.cj.layer(ctx, s, 's12:tree', wk.seg(t, 1, a + 3), (g, k) => wk.cj.tree(g, { x: 0.55 * W, y: 0.86 * H, h: 0.34 * H, lean: -0.08, progress: k, u, seed: 173, crown: 'wash' }));
    wk.cj.frame(ctx, t, s, { into: 'mist', out: 'ink' });
  },
});
