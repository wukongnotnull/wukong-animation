// s02 —— 雾、水、小舟。中景：雾散开，江面水纹写出，一叶小舟随之写成，停住后雾遮
wk.shot({
  render(ctx, t, s) {
    wk.hj.boatScene(ctx, s, {
      ripples: wk.seg(t, 0.6, 1.8),
      boat: wk.seg(t, 0.8, 2.3),
    });
    wk.hj.veil(ctx, s, 1 - wk.seg(t, 0, 0.8) + wk.seg(t, 3.4, 4.0));
  },
});
