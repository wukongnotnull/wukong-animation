// s02 —— 水、小舟。江面几笔水纹写出，一叶小舟随之写成，停住
wk.shot({
  render(ctx, t, s) {
    wk.hj.scene(ctx, s, {
      far: 1,
      mid: 1,
      rock: 1,
      ripples: wk.seg(t, 0.3, 1.8),
      boat: wk.seg(t, 1.0, 3.0),
    });
  },
});
