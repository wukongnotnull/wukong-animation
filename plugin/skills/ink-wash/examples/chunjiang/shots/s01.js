// s01 —— 宣纸、题字、雾。近景：空纸右侧三分之一处竖排题字「春江花月夜」逐字写出，停住后雾遮
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    wk.ink.paper(ctx, s);
    wk.ink.inscribe(ctx, '春江花月夜', { x: 0.68 * W, y: 0.2 * H, size: 84 * u, progress: wk.seg(t, 0.4, 2.4) });
    wk.cj.frame(ctx, t, s, { out: 'mist' });
  },
});
