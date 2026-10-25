/* 水墨写意 · 风格积木 —— 挂在 wk.ink 下。依赖 wk.c2d（canvas2d）与 wk.gl（webgl）。
 * 这些函数把 STYLE.md 里的技法变成可直接调用的代码，镜头里只管"组合"和"编排"。
 * 尺寸都按 1080p 设计，内部用 u = 画高/1080 换算，所以小样（半分辨率）和终版渲染构图一致。
 */
(function () {
  'use strict';
  const C = wk.c2d;
  const ink = (wk.ink = {});

  /** 墨分五色 + 宣纸 + 朱砂（STYLE.md §2） */
  ink.palette = {
    paper: '#F2EDE3',
    jiao: '#141414', // 焦
    nong: '#2B2B2B', // 浓
    zhong: '#4D4D4D', // 重
    dan: '#8C8A86', // 淡
    qing: '#C9C4BA', // 清
    zhusha: '#B22C22', // 朱砂
  };
  const P = ink.palette;

  /**
   * 铺宣纸（已缓存）。
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} s 镜头状态（取 W、H）
   * @param {number} [seed=72]
   */
  ink.paper = function (ctx, s, seed = 72) {
    ctx.drawImage(C.paper(s.W, s.H, { color: P.paper, seed }), 0, 0);
  };

  // ───────────── 墨滴晕开（WebGL）§4.3 ─────────────
  const DROP_FRAG = `
uniform vec2 u_center;
uniform float u_radius;
uniform float u_seed;
uniform float u_density;
uniform vec3 u_color;
{{noise}}
void main() {
  vec2 p = v_uv * u_res;
  vec2 d = p - u_center;
  float dist = length(d);
  float ang = atan(d.y, d.x);
  vec2 ring = vec2(cos(ang), sin(ang));
  // 不规则边缘：极坐标低频 + 局部高频
  float wob = 0.2 * fbm(ring * 0.9 + u_seed, 3) + 0.07 * fbm(ring * 3.5 + u_seed * 1.7, 2) + 0.018 * fbm(p / max(6.0, u_radius * 0.08) + u_seed * 3.1, 2);
  float r = u_radius * (1.0 + wob);
  float feather = u_radius * 0.05 + 1.5;
  float inside = smoothstep(r, r - feather, dist);
  float k = clamp(dist / max(r, 1.0), 0.0, 1.0);
  // 中心浓、边缘淡，带颗粒（宣纸吸墨不均）
  float body = mix(1.0, 0.42, smoothstep(0.0, 0.95, k));
  float gran = 0.86 + 0.14 * fbm(p / max(20.0, u_radius * 0.35) + u_seed, 4);
  // 水线：边缘内侧一圈更深
  float wl = exp(-pow((r - dist) / (u_radius * 0.03 + 1.2), 2.0));
  // 外侧极淡的水渍
  float halo = smoothstep(r * 1.14, r, dist) * (1.0 - inside) * 0.10;
  float a = clamp((inside * (body * gran * 0.78 + wl * 0.35) + halo) * u_density, 0.0, 1.0);
  gl_FragColor = vec4(u_color * a, a);
}`;

  /**
   * 墨滴落纸晕开。扩散本身由调用方用 progress 控制（建议 cubicOut：先快后慢最后停住）。
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} o
   * @param {number} o.x @param {number} o.y   中心
   * @param {number} o.r                      当前半径（像素）
   * @param {number} [o.density=1]            墨量 0..1
   * @param {string} [o.color=浓墨]
   * @param {number} [o.seed=1]
   */
  ink.drop = function (ctx, o) {
    if (o.r <= 0.5) return;
    const size = Math.ceil(o.r * 2.6);
    const fx = wk.gl.shader(DROP_FRAG, { width: size, height: size });
    const cv = fx.render({
      u_center: [size / 2, size / 2],
      u_radius: o.r,
      u_seed: (o.seed ?? 1) * 0.731,
      u_density: o.density ?? 1,
      u_color: wk.gl.color(o.color || P.nong),
    });
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(cv, o.x - size / 2, o.y - size / 2);
    ctx.restore();
  };

  // ───────────── 山 §4.4 ─────────────

  /**
   * 一层山：淡墨晕染的山体（山脚入雾）+ 山脊笔线 + 皴擦。
   * 建议在 setup 之外用 wk.c2d.cached 缓存成图层，再按进度淡入。
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} o
   * @param {number} o.x0 @param {number} o.x1 @param {number} o.y  左右范围与山脚基线
   * @param {number} o.amp                      起伏
   * @param {number[][]} [o.peaks]              主峰 [[中心0..1, 高度, 宽度0..1], ...]
   * @param {string} [o.tone=淡墨]              这一层的墨色（远淡近浓）
   * @param {number} [o.alpha=0.5]
   * @param {number} [o.line=1]                 山脊线的笔宽倍数（0 = 不画线，远山常用）
   * @param {number} [o.cun=1]                  皴擦密度倍数（0 = 不皴）
   * @param {number} [o.depth]                  山体向下延伸多少后完全入雾
   * @param {number} [o.u=1]                    设计单位（s.u）
   * @param {number} [o.seed=1]
   */
  ink.mountain = function (ctx, o) {
    const u = o.u ?? 1;
    const seed = o.seed ?? 1;
    const tone = o.tone || P.dan;
    const ridge = C.ridge({ x0: o.x0, x1: o.x1, y: o.y, amp: o.amp, peaks: o.peaks, freq: o.freq ?? 1.4, step: 5 * u, seed, taper: o.taper ?? [0, 0.14] });
    const depth = o.depth ?? o.amp * 0.9;
    const top = Math.min(...ridge.map((p) => p[1]));
    const body = [...ridge, [o.x1, o.y + depth], [o.x0, o.y + depth]];
    // 山体晕染：从峰顶往下渐淡入雾
    C.wash(ctx, body, {
      color: tone,
      alpha: o.alpha ?? 0.5,
      blur: 4 * u,
      edge: 0.25,
      edgeWidth: 2.5 * u,
      fade: [top + (o.y - top) * 0.35, o.y + depth * 0.6],
      fadeRight: [o.x1 - (o.x1 - o.x0) * 0.1, o.x1],
    });
    // 山脊线：一笔或几笔，带起收与飞白
    const lineW = (o.line ?? 1) * 7 * u;
    if (lineW > 0.3) {
      const r = wk.rng(seed + 11);
      let i = 0;
      while (i < ridge.length - 3) {
        const len = Math.floor(r.range(0.18, 0.4) * ridge.length);
        const seg = ridge.slice(i, Math.min(ridge.length, i + len + 1)).filter((_, k) => k % 3 === 0);
        if (seg.length >= 3) {
          C.brush(ctx, seg, {
            width: lineW * r.range(0.6, 1.2),
            color: tone === P.dan || tone === P.qing ? P.zhong : P.nong,
            alpha: 0.8,
            dry: 0.55,
            pressure: (q) => 0.55 + 0.9 * Math.abs(Math.sin(q * 3.1 + i)),
            taper: [0.15, 0.35],
            bristles: 10,
            seed: seed * 31 + i,
          });
        }
        i += len + Math.floor(r.range(0.02, 0.09) * ridge.length);
      }
    }
    // 皴擦：沿山体向内的短促斜笔（披麻皴的简化），越往下越稀
    const cun = o.cun ?? 1;
    if (cun > 0) {
      const r = wk.rng(seed + 23);
      const n = Math.floor(((o.x1 - o.x0) / (14 * u)) * cun);
      for (let k = 0; k < n; k++) {
        const idx = Math.floor(r() * ridge.length);
        const [px, py] = ridge[idx];
        const h = o.y - py;
        if (h < o.amp * 0.15) continue;
        const dn = Math.pow(r(), 1.6) * h * 0.7;
        const x = px + r.range(-6, 6) * u;
        const y = py + dn + 4 * u;
        const len = r.range(14, 34) * u * (1 - dn / h);
        const lean = (idx / ridge.length < 0.5 ? -1 : 1) * r.range(0.25, 0.6);
        C.brush(ctx, [[x, y], [x + len * lean * 0.5, y + len * 0.5], [x + len * lean, y + len]], {
          width: r.range(1.6, 3.4) * u,
          color: tone,
          alpha: 0.5 * (1 - dn / h),
          dry: 0.7,
          taper: [0.2, 0.5],
          bristles: 5,
          bleed: 0.6 * u,
          seed: seed * 97 + k,
        });
      }
    }
  };

  // ───────────── 水 §4.5 ─────────────

  /**
   * 几笔横向淡墨水纹（水是"留"出来的，别画多）。
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} o
   * @param {number} o.x @param {number} o.y @param {number} o.w   中心与宽度
   * @param {number} [o.n=4]          笔数
   * @param {number} [o.progress=1]
   * @param {number} [o.t=0]          时间：让水纹极轻微地起伏
   * @param {number} [o.u=1]
   * @param {number} [o.seed=1]
   */
  ink.ripples = function (ctx, o) {
    const u = o.u ?? 1;
    const r = wk.rng(o.seed ?? 1);
    const n = o.n ?? 4;
    for (let i = 0; i < n; i++) {
      const k = wk.stagger(o.progress ?? 1, i, n, 0, 1, 0.6);
      if (k <= 0) continue;
      const w = o.w * r.range(0.35, 1) * (1 - i * 0.12);
      const x = o.x + r.range(-0.3, 0.3) * o.w;
      const y = o.y + i * r.range(9, 16) * u + Math.sin((o.t ?? 0) * 0.8 + i) * 1.2 * u;
      const pts = [];
      for (let j = 0; j <= 6; j++) pts.push([x - w / 2 + (w * j) / 6, y + Math.sin(j * 1.3 + i) * 2.2 * u]);
      C.brush(ctx, pts, {
        width: r.range(1.8, 3.2) * u,
        color: P.dan,
        alpha: 0.7,
        progress: k,
        dry: 0.6,
        taper: [0.3, 0.4],
        bristles: 6,
        seed: (o.seed ?? 1) * 13 + i,
      });
    }
  };

  // ───────────── 小舟 ─────────────

  /**
   * 一叶小舟（舟身 + 篷 + 蓑笠渔翁），按 progress 依次"写"出。
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} o
   * @param {number} o.x @param {number} o.y  舟身中心（吃水线）
   * @param {number} [o.size=1]               大小倍数（1 ≈ 舟长 220px@1080p）
   * @param {number} [o.progress=1]
   * @param {number} [o.u=1]
   * @param {number} [o.seed=5]
   */
  ink.boat = function (ctx, o) {
    // 画完之后缓存成图层，后续帧只做平移（随波起伏）
    if ((o.progress ?? 1) >= 1 && !o._raw) {
      const uu = (o.u ?? 1) * (o.size ?? 1);
      const w = 420 * uu, h = 200 * uu;
      const img = C.cached(`boat:${uu}:${o.seed ?? 5}`, w, h, (g) => ink.boat(g, { ...o, x: w * 0.3, y: h * 0.62, progress: 1, _raw: true }));
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(img, o.x - w * 0.3, o.y - h * 0.62);
      ctx.restore();
      return;
    }
    const u = (o.u ?? 1) * (o.size ?? 1);
    const x = o.x, y = o.y;
    const L = 110 * u;
    const pr = o.progress ?? 1;
    const seed = o.seed ?? 5;
    const strokes = [
      // 舟身：一笔浓墨，两头上翘，舟尾略高
      { pts: [[x - L, y - 18 * u], [x - L * 0.62, y + 1 * u], [x, y + 6 * u], [x + L * 0.6, y + 1 * u], [x + L * 1.02, y - 13 * u]], w: 12, c: P.jiao, dry: 0.35, taper: [0.08, 0.3] },
      // 舷线
      { pts: [[x - L * 0.9, y - 12 * u], [x - L * 0.2, y - 5 * u], [x + L * 0.85, y - 9 * u]], w: 3.5, c: P.zhong, dry: 0.55, taper: [0.25, 0.35] },
      // 篷：低矮的半圆篷，用宽笔一笔扫出（后面再补一层淡墨）
      { pts: [[x - L * 0.5, y - 9 * u], [x - L * 0.42, y - 27 * u], [x - L * 0.18, y - 33 * u], [x + L * 0.05, y - 27 * u], [x + L * 0.12, y - 10 * u]], w: 9, c: P.nong, dry: 0.5, taper: [0.12, 0.35] },
      // 渔翁：坐姿，一团浓墨
      { pts: [[x + L * 0.4, y - 9 * u], [x + L * 0.43, y - 20 * u], [x + L * 0.45, y - 26 * u]], w: 13, c: P.nong, dry: 0.15, taper: [0.35, 0.3] },
      // 斗笠：扁平的一笔
      { pts: [[x + L * 0.32, y - 26 * u], [x + L * 0.45, y - 33 * u], [x + L * 0.58, y - 26 * u]], w: 4.5, c: P.jiao, dry: 0.1, taper: [0.15, 0.15] },
      // 钓竿：极细长线，向右上斜出
      { pts: [[x + L * 0.48, y - 20 * u], [x + L * 1.05, y - 52 * u], [x + L * 1.55, y - 74 * u]], w: 1.5, c: P.zhong, dry: 0.2, taper: [0.05, 0.6] },
    ];
    // 篷的淡墨衬底
    const kb = wk.stagger(pr, 2, 6, 0, 1, 0.25);
    if (kb > 0) {
      const hood = [[x - L * 0.47, y - 8 * u], [x - L * 0.4, y - 25 * u], [x - L * 0.18, y - 31 * u], [x + L * 0.04, y - 25 * u], [x + L * 0.1, y - 8 * u]];
      ctx.save();
      ctx.globalAlpha *= wk.ease.sineInOut(kb);
      C.wash(ctx, hood, { color: P.dan, alpha: 0.55, blur: 2 * u, edge: 0, bounds: [x - L, y - 60 * u, L * 1.4, 80 * u] });
      ctx.restore();
    }
    strokes.forEach((st, i) => {
      const k = wk.stagger(pr, i, strokes.length, 0, 1, 0.25, 'sineInOut');
      if (k <= 0) return;
      C.brush(ctx, st.pts, { width: st.w * u, color: st.c, alpha: 0.95, dry: st.dry, taper: st.taper, progress: k, bristles: 12, seed: seed * 17 + i });
    });
    // 钓线：几乎看不见的垂线
    const kl = wk.seg(pr, 0.85, 1);
    if (kl > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = C.rgba(P.dan, 0.6);
      ctx.lineWidth = 0.8 * u;
      ctx.beginPath();
      ctx.moveTo(x + L * 1.55, y - 74 * u);
      ctx.lineTo(x + L * 1.55, y - 74 * u + (72 * u) * kl);
      ctx.stroke();
      ctx.restore();
    }
  };

  // ───────────── 题字与印章 §4.6 ─────────────

  /** 竖排题字（右起），默认马善政楷书。参数同 wk.c2d.verticalText。 */
  ink.inscribe = function (ctx, text, o) {
    C.verticalText(ctx, text, { family: 'Ma Shan Zheng', color: P.jiao, ...o });
  };

  /** 朱砂白文印。参数同 wk.c2d.seal。 */
  ink.seal = function (ctx, o) {
    C.seal(ctx, { color: P.zhusha, family: 'Ma Shan Zheng', ...o });
  };

  /** 雾带（用宣纸色"遮"出来）。参数同 wk.c2d.mist。 */
  ink.mist = function (ctx, o) {
    C.mist(ctx, { color: P.paper, ...o });
  };
})();
