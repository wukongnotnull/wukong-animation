// s11 —— 扁舟、水、楼（远）、雾。中景：左下一叶扁舟逐笔写出，舟随水轻浮，远处右上一座小楼的清墨剪影
wk.shot({
  render(ctx, t, s) {
    const { W, H, u } = s;
    const P = wk.ink.palette;
    const a = s.cueIn('第19句');
    wk.ink.paper(ctx, s);
    wk.cj.layer(ctx, s, 's11:far', 1, (g) => {
      wk.cj.pavilion(g, { x: 0.8 * W, y: 0.42 * H, w: 0.07 * W, u, seed: 161, tone: P.qing, roofTone: P.qing });
      wk.ink.mountain(g, { x0: 0.6 * W, x1: 1.05 * W, y: 0.43 * H, amp: 40 * u, tone: P.qing, alpha: 0.35, line: 0, cun: 0, u, seed: 162 });
    });
    wk.ink.mist(ctx, { y: 0.45 * H, h: 50 * u, x0: 0.5 * W, x1: 1.1 * W, alpha: 0.6, t: s.gt, seed: 163 });
    wk.cj.waves(ctx, { x0: 0.05 * W, x1: 0.8 * W, y: 0.76 * H, n: 5, gap: 16, progress: wk.seg(t, 0.4, a), t: s.gt, u, seed: 164 });
    const bob = Math.sin(s.gt * 0.9) * 5 * u;
    ctx.save();
    ctx.translate(0, bob);
    wk.cj.layer(ctx, s, 's11:skiff', wk.seg(t, 0.8, a + 2.5), (g, k) => wk.cj.skiff(g, { x: 0.36 * W, y: 0.72 * H, L: 0.25 * W, progress: k, u, seed: 165 }));
    ctx.restore();
    wk.cj.frame(ctx, t, s, { into: 'ink', out: 'mist' });
  },
});
