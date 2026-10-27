// s03 —— 雾、题字、印章。远景：雾散开回到整幅画，右上竖排题字逐字写出，落一方朱砂印，留白收尾
wk.shot({
  render(ctx, t, s) {
    wk.hj.scene(ctx, s, {
      far: 1,
      mid: 1,
      rock: 1,
      ripples: 1,
      boat: 1,
      text: wk.seg(t, 0.9, 2.5),
      seal: wk.seg(t, 2.8, 3.05),
    });
    wk.hj.veil(ctx, s, 1 - wk.seg(t, 0, 0.8));
  },
});
