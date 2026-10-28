// s13 —— 楼窗、竹帘、捣衣砧、月光带。近景：窗、帘、砧、杵逐笔写出，一道斜斜的月光来回扫过砧面（拂还来）
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const a = s.cueIn('第23句');
    const b = s.cueIn('第24句');
    wk.ink.paper(ctx, s);
    wk.cj.layer(ctx, s, 's13:window', wk.seg(t, 0.5, a + 1.5), (g, k) => wk.cj.window(g, { x0: 0.5 * W, y0: 0.08 * H, x1: 1.02 * W, y1: 0.6 * H, roll: 0.42, progress: k, u, seed: 181 }));
    wk.cj.layer(ctx, s, 's13:anvil', wk.seg(t, a + 0.5, b + 1.5), (g, k) => wk.cj.anvil(g, { x: 0.68 * W, y: 0.8 * H, w: 0.22 * W, progress: k, u, seed: 182 }));
    // 月光带随第 24 句来回扫过砧面
    const sweep = Math.sin(Math.max(0, t - b) * 1.6) * 0.05 * W * wk.seg(t, b, b + 0.8);
    wk.cj.beam(ctx, s, { top: [0.12 * W, 0.24 * W], bottom: [0.56 * W, 0.8 * W], shift: sweep, k: wk.seg(t, 0.4, 2) });
    wk.cj.frame(ctx, t, s, { into: 'ink', out: 'mist' });
  },
});
