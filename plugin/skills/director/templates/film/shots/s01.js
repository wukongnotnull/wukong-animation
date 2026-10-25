// s01 —— 写法见 director/SHOT.md
wk.shot({
  setup(s) {
    return {};
  },
  render(ctx, t, s) {
    ctx.fillStyle = '#F2EDE3';
    ctx.fillRect(0, 0, s.W, s.H);
  },
});
