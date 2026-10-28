// s04 —— 水、山石（芳甸）、碎点（花林）、月。全景：江流绕过芳甸，坡上花林由疏到密点出
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const a = s.cueIn('第5句');
    const b = s.cueOut('第6句');
    wk.ink.paper(ctx, s);
    wk.cj.moon(ctx, { x: 0.82 * W, y: 0.2 * H, r: 40 * u });
    ctx.save();
    ctx.translate(-0.008 * W * t, 0);
    wk.cj.layer(ctx, s, 's04:land', wk.seg(t, 0.2, 1.4), (g, k) => {
      wk.cj.washIn(g, k, [[0.02 * W, 0.98 * H], [0.12 * W, 0.7 * H], [0.3 * W, 0.62 * H], [0.5 * W, 0.66 * H], [0.68 * W, 0.8 * H], [0.75 * W, 0.98 * H]], { color: P.dan, alpha: 0.32, blur: 10 * u, edge: 0.3, edgeWidth: 2 * u, fade: [0.68 * H, 1.0 * H] });
    }, 0.2);
    const river = wk.seg(t, a - 0.4, a + 2.2);
    wk.cj.layer(ctx, s, 's04:river', river, (g, k) => {
      const banks = [[[1.15 * W, 0.34 * H], [0.95 * W, 0.42 * H], [0.78 * W, 0.6 * H], [0.8 * W, 0.86 * H], [0.95 * W, 1.02 * H]], [[1.15 * W, 0.42 * H], [1.0 * W, 0.5 * H], [0.9 * W, 0.66 * H], [0.95 * W, 0.84 * H], [1.1 * W, 0.98 * H]]];
      banks.forEach((pts, i) => wk.c2d.brush(g, pts, { width: 3 * u, color: i ? P.qing : P.dan, alpha: 0.75, progress: k, dry: 0.6, taper: [0.2, 0.4], bristles: 7, seed: 61 + i }));
    }, 0.2);
    const TREES = [[0.12, 230, 0.08], [0.18, 290, -0.05], [0.24, 260, 0.1], [0.3, 310, -0.04], [0.37, 250, 0.06], [0.44, 220, -0.06], [0.5, 180, 0.04]];
    const forest = wk.seg(t, a + 0.6, b);
    wk.cj.layer(ctx, s, 's04:forest', forest, (g, k) => {
      TREES.forEach(([x, h, lean], i) => wk.cj.tree(g, { x: x * W, y: (0.64 + i * 0.006) * H, h: h * u, lean, progress: wk.stagger(k, i, TREES.length, 0, 1, 0.5), u, seed: 70 + i, tone: P.dan, crownTone: i % 3 ? P.qing : P.dan, density: 1.8 }));
    }, 0.2);
    ctx.restore();
    wk.cj.frame(ctx, t, s, { into: 'mist', out: 'ink' });
  },
});
