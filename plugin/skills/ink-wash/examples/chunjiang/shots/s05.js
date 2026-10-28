// s05 —— 笔触（花枝）、碎点（花、霜）、晕染（白沙）。中景：花林局部，流霜飘落，汀上白沙慢慢淡去
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const b = s.cueOut('第8句');
    wk.ink.paper(ctx, s);
    // 汀上白沙：左下一抹清墨，随第 8 句淡去
    const sand = 1 - wk.seg(t, b - 2.5, b);
    wk.cj.washIn(ctx, sand, wk.cj.blob(0.14 * W, 0.93 * H, 0.16 * W, 0.04 * H, 81), { color: P.qing, alpha: 0.6, blur: 8 * u, edge: 0.2 });
    wk.cj.layer(ctx, s, 's05:branches', 1, (g) => {
      const BR = [[[0.38, 1.02], [0.42, 0.8], [0.5, 0.64], [0.58, 0.56]], [[0.55, 1.02], [0.6, 0.84], [0.7, 0.72], [0.82, 0.66]], [[0.72, 1.02], [0.74, 0.88], [0.8, 0.8], [0.9, 0.78]]];
      BR.forEach((pts, i) => {
        wk.c2d.brush(g, pts.map(([x, y]) => [x * W, y * H]), { width: (9 - i * 2) * u, color: P.zhong, alpha: 0.8, dry: 0.5, taper: [0.05, 0.6], bristles: 10, seed: 82 + i });
        pts.slice(1).forEach(([x, y], j) => wk.cj.dots(g, { cx: x * W, cy: y * H, rx: 90 * u, ry: 55 * u, n: 70, size: 5, u, seed: 90 + i * 5 + j, color: j % 2 ? P.qing : P.dan, alpha: 0.7 }));
      });
    });
    // 流霜：清墨细点极慢地落下（每秒约 0.8% 画高），循环位置只由时间决定
    const r = wk.rng(97);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 40; i++) {
      const x0 = r() * W;
      const y0 = r() * 0.6 * H;
      const sz = r.range(1.2, 2.6) * u;
      const y = 0.05 * H + ((y0 + 0.008 * H * s.gt) % (0.6 * H));
      ctx.fillStyle = wk.c2d.rgba(P.qing, 0.6);
      ctx.beginPath();
      ctx.arc(x0 + Math.sin(s.gt * 0.5 + i) * 6 * u, y, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    wk.cj.frame(ctx, t, s, { into: 'ink', out: 'mist' });
  },
});
