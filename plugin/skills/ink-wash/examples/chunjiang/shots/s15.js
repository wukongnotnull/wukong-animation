// s15 —— 雁、水、水圈、笔触（跃鱼）、月。中景：一行鸿雁飞向月，江面一尾鱼跃起，水纹一圈圈荡开
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const f = s.cueIn('第28句');
    wk.ink.paper(ctx, s);
    wk.cj.moon(ctx, { x: 0.8 * W, y: 0.22 * H, r: 50 * u });
    wk.cj.layer(ctx, s, 's15:water', 1, (g) => wk.cj.waves(g, { x0: 0.05 * W, x1: 0.95 * W, y: 0.74 * H, n: 4, gap: 18, u, seed: 201, tone: P.qing, alpha: 0.8 }));
    wk.cj.geese(ctx, { x: (0.3 + 0.02 * t) * W, y: (0.36 - 0.006 * t) * H, n: 6, t: s.gt, k: wk.seg(t, 0.6, 1.6), u, seed: 202 });
    // 跃鱼：第 28 句起念时跃出水面，一道弧线，落回后水圈荡开
    const jump = wk.seg(t, f, f + 0.9);
    if (jump > 0 && jump < 1) {
      const ang = Math.PI * jump;
      const fx = 0.48 * W + jump * 80 * u;
      const fy = 0.76 * H - Math.sin(ang) * 70 * u;
      wk.c2d.brush(ctx, [[fx - 22 * u * Math.cos(ang - 0.6), fy + 12 * u * Math.sin(ang - 0.6)], [fx, fy], [fx + 20 * u, fy + 8 * u * Math.cos(ang)]], { width: 9 * u, color: P.nong, alpha: 0.9, dry: 0.2, taper: [0.4, 0.5], bristles: 8, seed: 203 });
    }
    wk.cj.rings(ctx, { x: 0.55 * W, y: 0.77 * H, births: [f + 0.85, f + 1.3, f + 1.8, f + 2.3], t, rmax: 190, u, seed: 204 });
    wk.cj.frame(ctx, t, s, { into: 'ink', out: 'mist' });
  },
});
