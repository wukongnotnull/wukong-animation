// s01 —— 山石、雾、墨滴。远景：远山从雾里淡出，近岸山石晕染成形，岸边一点墨石晕开；停住后雾遮
wk.shot({
  render(ctx, t, s) {
    wk.hj.scene(ctx, s, {
      far: wk.seg(t, 0.2, 1.6),
      mid: wk.seg(t, 0.8, 2.2),
      rock: wk.seg(t, 1.2, 2.4),
    });
    wk.hj.veil(ctx, s, wk.seg(t, 3.4, 4.0));
  },
});
