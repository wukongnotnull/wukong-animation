// s10 —— 树（枫）、碎点、晕染（白云）、水、月。远景：青枫浦一丛重墨枫树写出，白云从右往左飘过
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const a = s.cueIn('第17句');
    wk.ink.paper(ctx, s);
    wk.cj.moon(ctx, { x: 0.62 * W, y: 0.2 * H, r: 34 * u });
    const cloud = wk.c2d.cached(`cj:s10:cloud:${W}x${H}`, Math.ceil(0.5 * W), Math.ceil(0.3 * H), (g) => {
      [[0.5, 0.5, 0.3, 0.22], [0.32, 0.56, 0.18, 0.16], [0.68, 0.58, 0.2, 0.15]].forEach(([x, y, rx, ry], i) => wk.c2d.wash(g, wk.cj.blob(x * 0.5 * W, y * 0.3 * H, rx * 0.5 * W, ry * 0.3 * H * 1.6, 141 + i), { color: P.qing, alpha: 0.28, blur: 26 * u, edge: 0.05 }));
    });
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(cloud, 0.58 * W - 0.01 * W * t, 0.08 * H);
    ctx.restore();
    wk.cj.layer(ctx, s, 's10:water', 1, (g) => wk.cj.waves(g, { x0: 0.35 * W, x1: 0.95 * W, y: 0.86 * H, n: 4, gap: 14, u, seed: 145 }));
    wk.cj.layer(ctx, s, 's10:pier', wk.seg(t, 0.6, 2), (g, k) => {
      wk.c2d.brush(g, [[0.33 * W, 0.88 * H], [0.45 * W, 0.885 * H]], { width: 6 * u, color: P.zhong, alpha: 0.85, progress: k, dry: 0.5, bristles: 8, seed: 146 });
      [0.36, 0.43].forEach((x, i) => wk.c2d.brush(g, [[x * W, 0.86 * H], [x * W, 0.93 * H]], { width: 4 * u, color: P.nong, alpha: 0.85, progress: k, dry: 0.4, bristles: 6, seed: 147 + i }));
    });
    const MAPLES = [[0.1, 0.3, 0.05], [0.19, 0.36, -0.06], [0.27, 0.26, 0.1]];
    wk.cj.layer(ctx, s, 's10:maples', wk.seg(t, a - 1, a + 3), (g, k) => {
      MAPLES.forEach(([x, h, lean], i) => wk.cj.tree(g, { x: x * W, y: 0.92 * H, h: h * H, lean, progress: wk.stagger(k, i, MAPLES.length, 0, 1, 0.5), u, seed: 150 + i, tone: P.nong, crownTone: P.zhong }));
    });
    wk.cj.frame(ctx, t, s, { into: 'mist', out: 'ink' });
  },
});
