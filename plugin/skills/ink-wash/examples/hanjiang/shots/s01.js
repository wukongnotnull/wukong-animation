// s01 —— 山石、雾、墨滴。远山从雾里淡出，近岸山石晕染成形，岸边一点墨石晕开
wk.shot({
  render(ctx, t, s) {
    wk.hj.scene(ctx, s, {
      far: wk.seg(t, 0.2, 2.0),
      mid: wk.seg(t, 1.0, 3.0),
      rock: wk.seg(t, 1.6, 3.4),
    });
  },
});
