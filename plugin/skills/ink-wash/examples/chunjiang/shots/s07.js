// s07 —— 山石（岸石）、人影、水、月。全景：江畔岸石晕开，岸上一个小人影逐笔写出，仰头望月
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const a = s.cueIn('第11句');
    wk.ink.paper(ctx, s);
    wk.cj.moon(ctx, { x: 0.74 * W, y: 0.22 * H, r: 44 * u });
    wk.cj.layer(ctx, s, 's07:water', 1, (g) => wk.cj.waves(g, { x0: 0.42 * W, x1: 1.0 * W, y: 0.8 * H, n: 5, gap: 14, u, seed: 111 }));
    wk.cj.layer(ctx, s, 's07:rock', wk.seg(t, 0.5, 2.2), (g, k) => wk.cj.rock(g, { x: 0.22 * W, y: 0.95 * H, w: 0.32 * W, h: 0.2 * H, progress: k, u, seed: 112 }));
    wk.cj.layer(ctx, s, 's07:figure', wk.seg(t, a - 0.6, a + 2.4), (g, k) => wk.cj.figure(g, { x: 0.25 * W, y: 0.79 * H, h: 0.26 * H, progress: k, u, seed: 113 }));
    wk.cj.frame(ctx, t, s, { into: 'mist', out: 'ink' });
  },
});
