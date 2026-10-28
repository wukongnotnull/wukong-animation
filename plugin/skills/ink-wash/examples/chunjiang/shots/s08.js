// s08 —— 人影、月、山石、水。中景：人影背对观众放大到左下，衣袂几笔写出，与右上的月相望
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const a = s.cueIn('第13句');
    wk.ink.paper(ctx, s);
    wk.cj.moon(ctx, { x: 0.76 * W, y: 0.24 * H, r: 60 * u });
    wk.cj.layer(ctx, s, 's08:ground', 1, (g) => {
      wk.cj.rock(g, { x: 0.24 * W, y: 1.06 * H, w: 0.42 * W, h: 0.14 * H, u, seed: 121 });
      wk.cj.waves(g, { x0: 0.5 * W, x1: 1.0 * W, y: 0.86 * H, n: 3, gap: 16, u, seed: 122, tone: wk.ink.palette.qing, alpha: 0.75 });
    });
    wk.cj.layer(ctx, s, 's08:figure', wk.seg(t, 0.6, a + 2.5), (g, k) => wk.cj.figure(g, { x: 0.28 * W, y: 0.98 * H, h: 0.55 * H, progress: k, u, seed: 123, back: true }));
    wk.cj.frame(ctx, t, s, { into: 'ink', out: 'mist' });
  },
});
