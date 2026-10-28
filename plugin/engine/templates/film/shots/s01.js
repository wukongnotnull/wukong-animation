// s01 —— （本镜用到的技法名，取自 STYLE.md「5. 技法」，如：雾、山石）。写法见 director/specs/SHOT.md
wk.shot({
  setup(s) {
    return {};
  },
  render(ctx, t, s) {
    ctx.fillStyle = '#F2EDE3';
    ctx.fillRect(0, 0, s.W, s.H);
  },
});
