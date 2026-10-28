/* 《春江花月夜》画面元素（wk.cj.*）：月、潮纹、月光碎影、碎点（花林 / 霜 / 枫叶）、树、人影、岸石、扁舟、楼、窗帘、捣衣砧、月光带、雁、水圈。
 * 长度按 1080p 设计、乘 u 换算；随机只来自 seed；progress 0..1 是"写到哪一步"。
 * 月亮不上色：一圈清墨晕托出纸色的圆（STYLE.md「2. 色彩」只用墨与纸）。
 */
(function () {
  'use strict';
  const C = wk.c2d;
  const P = wk.ink.palette;
  const cj = (wk.cj = wk.cj || {});

  /** 不规则团块的多边形点（晕染面用）。 */
  function blob(cx, cy, rx, ry, seed, n = 28, rough = 0.18) {
    const nz = wk.noise(seed);
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const k = 1 + rough * nz.n1(Math.cos(a) * 1.3 + Math.sin(a) * 0.7 + seed);
      return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
    });
  }

  /** 淡入一层晕染面。 */
  function washIn(ctx, k, shape, o) {
    if (k <= 0) return;
    ctx.save();
    ctx.globalAlpha *= wk.ease.sineInOut(Math.min(1, k));
    C.wash(ctx, shape, o);
    ctx.restore();
  }

  /** 月：清墨晕托出的留白圆，晕的边缘带水线。k 为显现程度。 */
  cj.moon = function (ctx, { x, y, r, k = 1 }) {
    if (k <= 0) return;
    const R = Math.max(4, Math.round(r));
    const S = Math.ceil(R * 6);
    const img = C.cached(`cj:moon:${R}`, S, S, (g) => {
      wk.ink.drop(g, { x: S / 2, y: S / 2, r: R * 2.1, density: 0.34, color: P.qing, seed: 21 });
      g.globalCompositeOperation = 'destination-out';
      g.filter = `blur(${Math.max(1, R * 0.05)}px)`;
      g.beginPath();
      g.arc(S / 2, S / 2, R, 0, Math.PI * 2);
      g.fill();
      g.filter = 'none';
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = C.rgba(P.qing, 0.55);
      g.lineWidth = Math.max(1, R * 0.025);
      g.stroke();
    });
    ctx.save();
    ctx.globalAlpha *= wk.ease.sineInOut(Math.min(1, k));
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(img, x - S / 2, y - S / 2);
    ctx.restore();
  };

  /** 几道长长的横向水纹 / 潮纹，越往下越宽、越疏。rtl 为从右往左写。 */
  cj.waves = function (ctx, { x0, x1, y, n = 5, gap = 14, progress = 1, t = 0, u = 1, seed = 1, alpha = 0.6, width = 2.4, tone = P.dan, rtl = false }) {
    const r = wk.rng(seed);
    for (let i = 0; i < n; i++) {
      const a = r.range(0, 0.3);
      const b = r.range(0.6, 1);
      const w = width * r.range(0.7, 1.2) * (1 + i * 0.2);
      const k = wk.stagger(progress, i, n, 0, 1, 0.6);
      if (k <= 0) continue;
      const yy = y + gap * u * i * (1 + i * 0.25);
      const xa = x0 + (x1 - x0) * a;
      const xb = x0 + (x1 - x0) * b;
      const pts = [];
      for (let j = 0; j <= 8; j++) pts.push([xa + ((xb - xa) * j) / 8, yy + Math.sin(j * 1.1 + i + t * 0.6) * 2 * u]);
      if (rtl) pts.reverse();
      C.brush(ctx, pts, { width: w * u, color: tone, alpha, progress: k, dry: 0.6, taper: [0.25, 0.4], bristles: 7, seed: seed * 13 + i });
    }
  };

  /** 江面上碎开的月光倒影：中间一道留白，两侧断续的短淡墨，越近越宽。 */
  cj.moonlight = function (ctx, { x, y0, y1, w0, w1, rows = 12, progress = 1, t = 0, u = 1, seed = 3, alpha = 0.65 }) {
    const r = wk.rng(seed);
    for (let i = 0; i < rows; i++) {
      const f = i / (rows - 1);
      const yy = y0 + (y1 - y0) * Math.pow(f, 1.4);
      const half = (w0 + (w1 - w0) * f) / 2;
      const gapW = half * r.range(0.25, 0.5);
      const len = half * r.range(0.4, 0.8);
      const k = wk.stagger(progress, i, rows, 0, 1, 0.5);
      if (k <= 0) continue;
      const sway = Math.sin(t * 0.9 + i * 1.7) * 3 * u * (0.5 + f);
      [-1, 1].forEach((side, j) => {
        const xa = x + side * gapW + sway;
        const xb = x + side * (gapW + len) + sway;
        C.brush(ctx, [[xa, yy], [(xa + xb) / 2, yy + u], [xb, yy]], { width: (1.4 + 2.4 * f) * u, color: P.dan, alpha, progress: k, dry: 0.5, taper: [0.3, 0.4], bristles: 5, seed: seed * 41 + i * 2 + j });
      });
    }
  };

  /** 一团碎点：花林、霰、枫叶。按序号依次点出。 */
  cj.dots = function (ctx, { cx, cy, rx, ry, n = 120, size = 4, progress = 1, seed = 1, u = 1, color = P.qing, alpha = 0.7 }) {
    const r = wk.rng(seed);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r());
      const sz = size * u * r.range(0.5, 1.4);
      const al = alpha * r.range(0.5, 1);
      const k = wk.clamp((progress * (n + 6) - i) / 6, 0, 1);
      if (k <= 0) continue;
      ctx.fillStyle = C.rgba(color, al * k);
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * d * rx, cy + Math.sin(a) * d * ry, sz, sz * 0.8, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  /** 一棵树：干、两三根枝、树冠（碎点或晕染）。sway 让树冠左右摇。 */
  cj.tree = function (ctx, { x, y, h, lean = 0.1, progress = 1, u = 1, seed = 1, tone = P.zhong, crown = 'dots', crownTone = P.dan, sway = 0, density = 1 }) {
    const r = wk.rng(seed);
    const top = [x + lean * h, y - h];
    const mid = [x + lean * h * 0.4 + r.range(-0.04, 0.04) * h, y - h * 0.5];
    const branches = [0, 1, 2].map((i) => ({ f: r.range(0.45, 0.85), dir: i % 2 ? 1 : -1, len: r.range(0.18, 0.3) }));
    const kT = wk.seg(progress, 0, 0.45);
    if (kT > 0) C.brush(ctx, [[x, y], mid, top], { width: h * 0.045, color: tone, alpha: 0.9, progress: kT, dry: 0.45, taper: [0.05, 0.6], bristles: 10, seed: seed * 7 });
    branches.forEach((b, i) => {
      const k = wk.seg(progress, 0.3 + i * 0.08, 0.6 + i * 0.08);
      if (k <= 0) return;
      const bx = x + lean * h * b.f;
      const by = y - h * b.f;
      C.brush(ctx, [[bx, by], [bx + b.dir * b.len * h * 0.6, by - b.len * h * 0.4], [bx + b.dir * b.len * h, by - b.len * h * 0.55]], { width: h * 0.016, color: tone, alpha: 0.85, progress: k, dry: 0.5, taper: [0.1, 0.7], bristles: 6, seed: seed * 11 + i });
    });
    const kc = wk.seg(progress, 0.5, 1);
    if (kc <= 0) return;
    const cx = top[0] + sway;
    const cy = top[1] + h * 0.08;
    if (crown === 'dots') {
      cj.dots(ctx, { cx, cy, rx: h * 0.42, ry: h * 0.28, n: Math.round((h / u) * 0.9 * density), size: (h * 0.02) / u, progress: kc, seed: seed * 13, u, color: crownTone, alpha: 0.75 });
    } else {
      washIn(ctx, kc, blob(cx, cy, h * 0.4, h * 0.26, seed * 17), { color: crownTone, alpha: 0.45, blur: 6 * u, edge: 0.3, edgeWidth: 2 * u });
    }
  };

  /** 立着的人影（长袍、垂袖、头与发髻）。y 是脚下；back 为背对观众。 */
  cj.figure = function (ctx, { x, y, h, progress = 1, u = 1, seed = 1, back = false }) {
    const k1 = wk.seg(progress, 0, 0.45);
    const k2 = wk.seg(progress, 0.3, 0.75);
    const k3 = wk.seg(progress, 0.6, 1);
    const sh = y - h * 0.8;
    const hw = h * 0.11;
    if (k1 > 0) {
      const robe = [[x - hw * 0.7, sh], [x - hw * 0.62, y - h * 0.5], [x - hw * 0.95, y - h * 0.2], [x - hw * 1.35, y], [x - hw * 0.5, y - h * 0.015], [x + hw * 0.2, y + h * 0.01], [x + hw * 1.25, y - h * 0.02], [x + hw * 0.9, y - h * 0.25], [x + hw * 0.6, y - h * 0.52], [x + hw * 0.7, sh]];
      washIn(ctx, k1, robe, { color: P.dan, alpha: 0.42, blur: 2.5 * u, edge: 0.45, edgeWidth: 1.5 * u, fade: [y - h * 0.5, y + h * 0.05] });
      C.brush(ctx, [[x - hw * 0.6, sh], [x - hw * 0.55, y - h * 0.5], [x - hw * 0.9, y - h * 0.22], [x - hw * 1.35, y]], { width: h * 0.028, color: P.nong, alpha: 0.9, progress: k1, dry: 0.5, pressure: (q) => 0.6 + 0.7 * Math.sin(q * Math.PI), taper: [0.1, 0.5], bristles: 9, seed: seed * 3 });
      C.brush(ctx, [[x + hw * 0.6, sh], [x + hw * 0.5, y - h * 0.5], [x + hw * 0.85, y - h * 0.26], [x + hw * 1.25, y - h * 0.02]], { width: h * 0.022, color: P.nong, alpha: 0.85, progress: k1, dry: 0.55, pressure: (q) => 0.5 + 0.8 * Math.sin(q * Math.PI), taper: [0.1, 0.5], bristles: 9, seed: seed * 3 + 1 });
      C.brush(ctx, [[x - hw * 0.6, y - h * 0.52], [x, y - h * 0.5], [x + hw * 0.55, y - h * 0.53]], { width: h * 0.014, color: P.zhong, alpha: 0.8, progress: k1, dry: 0.4, taper: [0.2, 0.2], bristles: 6, seed: seed * 3 + 2 });
    }
    if (k2 > 0) {
      const sd = back ? -1 : 1;
      C.brush(ctx, [[x + sd * hw * 0.5, sh + h * 0.04], [x + sd * hw * 1.5, y - h * 0.5], [x + sd * hw * 1.1, y - h * 0.38]], { width: h * 0.045, color: P.zhong, alpha: 0.85, progress: k2, dry: 0.5, taper: [0.15, 0.5], bristles: 8, seed: seed * 5 });
    }
    if (k3 > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha *= k3;
      ctx.fillStyle = C.rgba(P.nong, 0.92);
      ctx.beginPath();
      ctx.ellipse(x + hw * 0.15, sh - h * 0.075, h * 0.055, h * 0.065, -0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + hw * 0.05, sh - h * 0.145, h * 0.026, h * 0.03, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  /** 岸石：晕染石体（下部入水）+ 顶上一笔干墨轮廓。y 是石脚。 */
  cj.rock = function (ctx, { x, y, w, h, progress = 1, u = 1, seed = 1, tone = P.zhong }) {
    const pts = blob(x, y - h * 0.45, w / 2, h / 2, seed, 24, 0.22).map(([px, py]) => [px, Math.min(py, y)]);
    washIn(ctx, wk.seg(progress, 0, 0.7), pts, { color: tone, alpha: 0.6, blur: 3 * u, edge: 0.5, edgeWidth: 2.5 * u, fade: [y - h * 0.4, y + h * 0.1] });
    const kl = wk.seg(progress, 0.3, 1);
    const top = pts.filter((p) => p[1] < y - h * 0.35).sort((a, b) => a[0] - b[0]);
    if (kl > 0 && top.length > 2) C.brush(ctx, top, { width: 6 * u, color: P.nong, alpha: 0.85, progress: kl, dry: 0.6, taper: [0.1, 0.3], bristles: 10, seed: seed * 9 });
  };

  /** 扁舟：舟身、舷线、舟中坐着一人（无篷、无钓竿）。x、y 是吃水线中心，L 是半个舟长。 */
  cj.skiff = function (ctx, { x, y, L, progress = 1, u = 1, seed = 5, tone = P.jiao }) {
    const sk = L / 110;
    const strokes = [
      { pts: [[x - L, y - 16 * sk], [x - L * 0.6, y + sk], [x, y + 6 * sk], [x + L * 0.6, y + sk], [x + L * 1.02, y - 12 * sk]], w: 11, c: tone, dry: 0.35, taper: [0.08, 0.3] },
      { pts: [[x - L * 0.9, y - 11 * sk], [x - L * 0.2, y - 5 * sk], [x + L * 0.85, y - 8 * sk]], w: 3.5, c: P.zhong, dry: 0.55, taper: [0.25, 0.35] },
      { pts: [[x - L * 0.12, y - 7 * sk], [x - L * 0.1, y - 22 * sk], [x - L * 0.06, y - 30 * sk]], w: 14, c: P.nong, dry: 0.15, taper: [0.35, 0.3] },
      { pts: [[x - L * 0.05, y - 24 * sk], [x + L * 0.12, y - 17 * sk], [x + L * 0.2, y - 12 * sk]], w: 5, c: P.zhong, dry: 0.4, taper: [0.2, 0.5] },
    ];
    strokes.forEach((st, i) => {
      const k = wk.stagger(progress, i, strokes.length + 1, 0, 1, 0.25);
      if (k > 0) C.brush(ctx, st.pts, { width: st.w * sk, color: st.c, alpha: 0.95, dry: st.dry, taper: st.taper, progress: k, bristles: 12, seed: seed * 17 + i });
    });
    const kh = wk.stagger(progress, strokes.length, strokes.length + 1, 0, 1, 0.25);
    if (kh > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha *= kh;
      ctx.fillStyle = C.rgba(P.nong, 0.92);
      ctx.beginPath();
      ctx.ellipse(x - L * 0.05, y - 36 * sk, 6.5 * sk, 7.5 * sk, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  /** 两层小楼：柱、檐、栏杆、歇山顶，屋面淡墨。x 是中心，y 是地面，w 是楼宽。 */
  cj.pavilion = function (ctx, { x, y, w, progress = 1, u = 1, seed = 1, tone = P.nong, roofTone = P.dan }) {
    const h1 = w * 0.42;
    const y1 = y - h1;
    const y2 = y1 - w * 0.46;
    const ov = w * 0.16;
    const eave = (yy, half, lift) => [[x - half - ov, yy - lift], [x - half * 0.6, yy + w * 0.015], [x, yy + w * 0.01], [x + half * 0.6, yy + w * 0.015], [x + half + ov, yy - lift]];
    const S = [];
    [-0.42, -0.14, 0.14, 0.42].forEach((f) => S.push({ pts: [[x + f * w, y], [x + f * w, y1 + w * 0.02]], w: 0.012, c: tone }));
    S.push({ pts: eave(y1, w * 0.5, w * 0.08), w: 0.024, c: P.jiao });
    S.push({ pts: [[x - w * 0.42, y1 - w * 0.12], [x + w * 0.42, y1 - w * 0.12]], w: 0.01, c: tone });
    S.push({ pts: [[x - w * 0.42, y1 - w * 0.05], [x + w * 0.42, y1 - w * 0.05]], w: 0.008, c: P.zhong });
    [-0.32, 0, 0.32].forEach((f) => S.push({ pts: [[x + f * w, y1 - w * 0.05], [x + f * w, y2 + w * 0.02]], w: 0.01, c: tone }));
    S.push({ pts: eave(y2, w * 0.4, w * 0.1), w: 0.028, c: P.jiao });
    S.push({ pts: [[x - w * 0.24, y2 - w * 0.03], [x - w * 0.1, y2 - w * 0.16], [x + w * 0.1, y2 - w * 0.16], [x + w * 0.24, y2 - w * 0.03]], w: 0.016, c: tone });
    washIn(ctx, wk.seg(progress, 0.55, 1), [[x - w * 0.62, y1 - w * 0.07], [x - w * 0.4, y1 - w * 0.13], [x + w * 0.4, y1 - w * 0.13], [x + w * 0.62, y1 - w * 0.07], [x + w * 0.5, y1], [x - w * 0.5, y1]], { color: roofTone, alpha: 0.5, blur: 2 * u, edge: 0.3, edgeWidth: 1.5 * u });
    washIn(ctx, wk.seg(progress, 0.6, 1), [[x - w * 0.54, y2 - w * 0.09], [x - w * 0.1, y2 - w * 0.16], [x + w * 0.1, y2 - w * 0.16], [x + w * 0.54, y2 - w * 0.09], [x + w * 0.4, y2], [x - w * 0.4, y2]], { color: roofTone, alpha: 0.5, blur: 2 * u, edge: 0.3, edgeWidth: 1.5 * u });
    S.forEach((st, i) => {
      const k = wk.stagger(wk.seg(progress, 0, 0.85), i, S.length, 0, 1, 0.4);
      if (k > 0) C.brush(ctx, st.pts, { width: Math.max(1.2 * u, st.w * w), color: st.c, alpha: 0.9, progress: k, dry: 0.45, taper: [0.1, 0.3], bristles: 8, seed: seed * 29 + i });
    });
  };

  /** 楼窗一角：窗框、半卷的竹帘（卷起处一道粗笔）。 */
  cj.window = function (ctx, { x0, y0, x1, y1, roll = 0.45, progress = 1, u = 1, seed = 1 }) {
    const frame = [[[x0, y0], [x1, y0]], [[x0, y0], [x0, y1]], [[x0, y1], [x1, y1]]];
    frame.forEach((pts, i) => {
      const k = wk.stagger(wk.seg(progress, 0, 0.5), i, frame.length, 0, 1, 0.3);
      if (k > 0) C.brush(ctx, pts, { width: (10 - i * 2) * u, color: P.zhong, alpha: 0.85, progress: k, dry: 0.65, pressure: (q) => 0.6 + 0.6 * Math.abs(Math.sin(q * 5 + i)), taper: [0.05, 0.3], bristles: 12, seed: seed * 7 + i });
    });
    const yb = y0 + (y1 - y0) * roll;
    const n = Math.floor((yb - y0) / (9 * u));
    for (let i = 1; i <= n; i++) {
      const k = wk.stagger(wk.seg(progress, 0.3, 0.9), i - 1, n, 0, 1, 0.5);
      const yy = y0 + i * 9 * u;
      const xa = x0 + (8 + ((i * 37) % 23)) * u;
      if (k > 0) C.brush(ctx, [[xa, yy], [(xa + x1) / 2, yy + 3 * u], [x1 - 4 * u, yy]], { width: 1.6 * u, color: i % 3 ? P.qing : P.dan, alpha: 0.8, progress: k, dry: 0.4, taper: [0.05, 0.1], bristles: 4, seed: seed * 31 + i });
    }
    [0.38, 0.7].forEach((f, i) => {
      const k = wk.seg(progress, 0.6 + i * 0.1, 0.9 + i * 0.05);
      const xx = x0 + (x1 - x0) * f;
      if (k > 0) C.brush(ctx, [[xx, yb + 10 * u], [xx + 2 * u, y1]], { width: 4 * u, color: P.dan, alpha: 0.75, progress: k, dry: 0.6, taper: [0.1, 0.2], bristles: 6, seed: seed * 41 + i });
    });
    const kr = wk.seg(progress, 0.8, 1);
    if (kr > 0) C.brush(ctx, [[x0 + 4 * u, yb], [x1 - 2 * u, yb + 2 * u]], { width: 16 * u, color: P.nong, alpha: 0.85, progress: kr, dry: 0.55, taper: [0.05, 0.1], bristles: 12, seed: seed * 37 });
  };

  /** 捣衣砧与木杵。x、y 是砧面中心，w 是砧宽。 */
  cj.anvil = function (ctx, { x, y, w, progress = 1, u = 1, seed = 1 }) {
    washIn(ctx, wk.seg(progress, 0, 0.5), blob(x, y + w * 0.12, w / 2, w * 0.16, seed, 24, 0.16), { color: P.zhong, alpha: 0.45, blur: 2 * u, edge: 0.5, edgeWidth: 2 * u, fade: [y + w * 0.05, y + w * 0.32] });
    const k1 = wk.seg(progress, 0.2, 0.6);
    if (k1 > 0) C.brush(ctx, [[x - w * 0.5, y], [x, y - w * 0.03], [x + w * 0.5, y + w * 0.01]], { width: 7 * u, color: P.nong, alpha: 0.9, progress: k1, dry: 0.5, taper: [0.1, 0.3], bristles: 10, seed: seed * 5 });
    [[-0.3, 0.06], [0.25, 0.1]].forEach(([fx, fy], i) => {
      const k = wk.seg(progress, 0.35 + i * 0.1, 0.7 + i * 0.1);
      if (k > 0) C.brush(ctx, [[x + fx * w, y + fy * w], [x + (fx + 0.05) * w, y + (fy + 0.08) * w], [x + (fx + 0.04) * w, y + (fy + 0.16) * w]], { width: 3 * u, color: P.zhong, alpha: 0.6, progress: k, dry: 0.75, taper: [0.2, 0.5], bristles: 5, seed: seed * 13 + i });
    });
    const k2 = wk.seg(progress, 0.5, 1);
    if (k2 > 0) C.brush(ctx, [[x - w * 0.42, y - w * 0.12], [x, y - w * 0.07], [x + w * 0.28, y - w * 0.04]], { width: w * 0.06, color: P.nong, alpha: 0.9, progress: k2, dry: 0.3, taper: [0.2, 0.2], bristles: 12, seed: seed * 7 });
  };

  let shadeCanvas = null;
  /**
   * 月光带：整幅压一层极淡的夜色，再把一道斜带擦回纸色。
   * 夜色只有淡墨 16%，与纸的色差在留白容差内，留白不受影响。
   */
  cj.beam = function (ctx, s, { top, bottom, shift = 0, k = 1 }) {
    if (k <= 0) return;
    const { W, H } = s;
    if (!shadeCanvas || shadeCanvas.canvas.width !== W || shadeCanvas.canvas.height !== H) shadeCanvas = C.offscreen(W, H);
    const g = shadeCanvas.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.fillStyle = C.rgba(P.dan, 0.16 * k);
    g.filter = `blur(${Math.round(60 * s.u)}px)`;
    g.beginPath();
    g.ellipse(0.66 * W, 0.58 * H, 0.42 * W, 0.46 * H, 0, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.filter = `blur(${Math.round(18 * s.u)}px)`;
    g.beginPath();
    g.moveTo(top[0] + shift, 0);
    g.lineTo(top[1] + shift, 0);
    g.lineTo(bottom[1] + shift, H);
    g.lineTo(bottom[0] + shift, H);
    g.closePath();
    g.fill();
    g.filter = 'none';
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(shadeCanvas.canvas, 0, 0);
    ctx.restore();
  };

  /** 一行人字形鸿雁，翅膀随时间轻扇。x、y 是头雁。 */
  cj.geese = function (ctx, { x, y, n = 6, dx = 60, dy = 26, size = 34, t = 0, k = 1, u = 1, seed = 1 }) {
    if (k <= 0) return;
    for (let j = 0; j < n; j++) {
      const rank = Math.ceil(j / 2);
      const side = j % 2 ? 1 : -1;
      const gx = x - rank * dx * u;
      const gy = y + side * rank * dy * u * (j ? 1 : 0);
      const flap = Math.sin(t * 5 + j * 1.3) * size * 0.22 * u;
      const sz = size * u;
      ctx.save();
      ctx.globalAlpha *= k;
      C.brush(ctx, [[gx - sz * 0.6, gy - sz * 0.15 + flap], [gx - sz * 0.25, gy - sz * 0.05], [gx, gy]], { width: sz * 0.12, color: P.nong, alpha: 0.9, dry: 0.3, taper: [0.5, 0.1], bristles: 5, seed: seed * 7 + j });
      C.brush(ctx, [[gx, gy], [gx + sz * 0.15, gy - sz * 0.1], [gx + sz * 0.3, gy - sz * 0.32 - flap]], { width: sz * 0.1, color: P.nong, alpha: 0.9, dry: 0.3, taper: [0.1, 0.5], bristles: 5, seed: seed * 7 + j + 50 });
      ctx.restore();
    }
  };

  /** 一圈圈水纹荡开：births 是每圈出现的时刻（同一时间轴上的秒）。 */
  cj.rings = function (ctx, { x, y, births, t, rmax = 160, u = 1, seed = 1, flat = 0.28 }) {
    births.forEach((tb, j) => {
      const age = t - tb;
      if (age <= 0) return;
      const r = rmax * u * (1 - Math.exp(-age * 0.9)) * (1 - j * 0.12);
      const a = 0.75 * Math.exp(-age * 0.25);
      if (r < 2 * u || a < 0.03) return;
      const pts = [];
      for (let i = 0; i <= 18; i++) {
        const ang = Math.PI * (0.08 + (i / 18) * 1.84);
        pts.push([x + Math.cos(ang) * r, y + Math.sin(ang) * r * flat]);
      }
      C.brush(ctx, pts, { width: 2.2 * u, color: P.dan, alpha: a, dry: 0.55, taper: [0.3, 0.3], bristles: 5, seed: seed * 19 + j });
    });
  };

  cj.blob = blob;
  cj.washIn = washIn;
})();
