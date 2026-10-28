// s16 —— 笔触（花枝）、碎点（花）、水、水圈、月（潭影）。近景：闲潭边花枝垂下，花瓣一片片落到水面荡开小圈
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const a = s.cueIn('第29句');
    const b = s.cueOut('第30句');
    wk.ink.paper(ctx, s);
    wk.cj.layer(ctx, s, 's16:pond', 1, (g) => {
      wk.c2d.brush(g, [[-0.02 * W, 0.47 * H], [0.35 * W, 0.44 * H], [0.7 * W, 0.46 * H], [1.02 * W, 0.43 * H]], { width: 5 * u, color: P.dan, alpha: 0.8, dry: 0.6, taper: [0.1, 0.2], bristles: 9, seed: 211 });
      wk.cj.rock(g, { x: 0.9 * W, y: 0.5 * H, w: 0.18 * W, h: 0.12 * H, u, seed: 212 });
      const br = [[-0.02 * W, 0.04 * H], [0.15 * W, 0.12 * H], [0.3 * W, 0.24 * H], [0.42 * W, 0.34 * H]];
      wk.c2d.brush(g, br, { width: 10 * u, color: P.zhong, alpha: 0.85, dry: 0.5, taper: [0.05, 0.7], bristles: 10, seed: 213 });
      br.slice(1).forEach(([x, y], i) => wk.cj.dots(g, { cx: x, cy: y, rx: 70 * u, ry: 45 * u, n: 50, size: 5, u, seed: 214 + i, color: i % 2 ? P.qing : P.dan, alpha: 0.7 }));
    });
    // 潭里一轮月影，几笔水纹横过
    ctx.save();
    ctx.translate(0.62 * W, 0.72 * H);
    ctx.scale(1, 0.85);
    wk.cj.moon(ctx, { x: 0, y: 0, r: 40 * u });
    ctx.restore();
    wk.cj.waves(ctx, { x0: 0.5 * W, x1: 0.75 * W, y: 0.7 * H, n: 2, gap: 20, t: s.gt, u, seed: 218, tone: P.qing, alpha: 0.7 });
    // 落花：六瓣，在两句之间依次落下，各用 2.2 秒落到水面
    const r = wk.rng(219);
    const births = [];
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 6; i++) {
      const t0 = a - 0.5 + ((b - a) * i) / 6;
      const x0 = r.range(0.12, 0.42) * W;
      const y0 = r.range(0.14, 0.32) * H;
      const x1 = x0 + r.range(0.04, 0.12) * W;
      const y1 = r.range(0.6, 0.86) * H;
      births.push([x1, y1, t0 + 2.2]);
      const k = wk.seg(t, t0, t0 + 2.2, 'sineInOut');
      if (k <= 0) continue;
      const px = x0 + (x1 - x0) * k + Math.sin(k * 6 + i) * 14 * u * (1 - k);
      const py = y0 + (y1 - y0) * k;
      ctx.fillStyle = wk.c2d.rgba(P.dan, 0.75);
      ctx.beginPath();
      ctx.ellipse(px, py, 6 * u, 3.6 * u, k * 3 + i, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    births.forEach(([x, y, tb], i) => wk.cj.rings(ctx, { x, y, births: [tb], t, rmax: 50, u, seed: 220 + i }));
    wk.cj.frame(ctx, t, s, { into: 'mist', out: 'mist' });
  },
});
