// s20 —— 题字、印章、晕染（树影）。近景：题字放大撑起画面右半，落「春江」朱砂印，最后极慢淡成纸面
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const stamp = s.cueIn('落印');
    wk.ink.paper(ctx, s);
    wk.cj.layer(ctx, s, 's20:tree', 1, (g) => {
      g.save();
      g.globalAlpha = 0.45;
      wk.cj.tree(g, { x: 0.16 * W, y: 0.95 * H, h: 0.62 * H, lean: 0.06, u, seed: 261, tone: P.dan, crown: 'wash', crownTone: P.qing });
      g.restore();
    });
    const size = 96 * u;
    wk.ink.inscribe(ctx, '落月摇情满江树', { x: 0.72 * W, y: 0.06 * H, size });
    wk.ink.seal(ctx, { x: 0.72 * W, y: 0.06 * H + size * 7 * 1.12 + 60 * u, size: 76 * u, text: '春江', progress: wk.seg(t, stamp - 0.2, stamp + 0.05), seed: 262 });
    wk.cj.frame(ctx, t, s, { into: 'ink', out: 'fade' });
  },
});
