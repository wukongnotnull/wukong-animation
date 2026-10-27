/* canvas2d 工具包 —— 挂在 wk.c2d 下。
 * 所有函数都是确定性的：随机性只来自传入的 seed。
 * 尺寸参数都是"实际像素"；在镜头里请用 s.u 换算（例如 width: 18 * s.u）。
 */
(function () {
  'use strict';
  const c2d = (wk.c2d = {});

  // ───────────────────────── 基础 ─────────────────────────

  /**
   * 创建离屏画布。
   * @param {number} w 宽
   * @param {number} h 高
   * @returns {{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}}
   */
  c2d.offscreen = function (w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w));
    canvas.height = Math.max(1, Math.ceil(h));
    return { canvas, ctx: canvas.getContext('2d') };
  };

  // 每次调用都新建离屏层。复用同一块画布在 Chromium 下会偶发"上一笔残影"
  // （被当作 drawImage 源之后再整块清空，延迟绘制的快照不可靠），新建的代价很小。
  function scratch(w, h) {
    return c2d.offscreen(w, h);
  }

  /** 把 "#rrggbb" 转成 "rgba(r,g,b,a)"。 */
  c2d.rgba = function (hex, a = 1) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  const memo = new Map();
  /**
   * 按 key 缓存一张离屏画布（只画一次）。用于纸张、静止的远山等不随时间变化的层。
   * @param {string} key   唯一键（建议带上尺寸与种子）
   * @param {number} w
   * @param {number} h
   * @param {(ctx: CanvasRenderingContext2D, w: number, h: number) => void} draw
   * @returns {HTMLCanvasElement}
   */
  c2d.cached = function (key, w, h, draw) {
    if (!memo.has(key)) {
      const o = c2d.offscreen(w, h);
      draw(o.ctx, o.canvas.width, o.canvas.height);
      memo.set(key, o.canvas);
    }
    return memo.get(key);
  };

  // ───────────────────────── 纸张 ─────────────────────────

  /**
   * 生成宣纸 / 纸张纹理（带低频斑驳、纤维和细颗粒），结果已缓存。
   * @param {number} w
   * @param {number} h
   * @param {{color?: string, seed?: number, mottle?: number, fibers?: number, grain?: number}} [o]
   * @returns {HTMLCanvasElement}
   */
  c2d.paper = function (w, h, o = {}) {
    const color = o.color || '#F2EDE3';
    const seed = o.seed ?? 1;
    const mottle = o.mottle ?? 0.018;
    const fibers = o.fibers ?? 320;
    const grain = o.grain ?? 0.05;
    const key = `paper:${w}x${h}:${color}:${seed}:${mottle}:${fibers}:${grain}`;
    return c2d.cached(key, w, h, (ctx) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      // 低频斑驳：在小画布上算 fBm，再平滑放大
      const n = wk.noise(seed);
      const sw = Math.ceil(w / 8), sh = Math.ceil(h / 8);
      const small = c2d.offscreen(sw, sh);
      const img = small.ctx.createImageData(sw, sh);
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const v = n.fbm2(x / 70, y / 70, 4);
          const i = (y * sw + x) * 4;
          const d = v > 0 ? 255 : 0;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = d;
          img.data[i + 3] = Math.abs(v) * mottle * 255 * 2;
        }
      }
      small.ctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small.canvas, 0, 0, w, h);
      // 纤维
      const r = wk.rng(seed + 7);
      ctx.lineCap = 'round';
      for (let i = 0; i < fibers; i++) {
        const x = r() * w, y = r() * h;
        const len = r.range(8, 46) * (h / 1080);
        const a = r.range(0, Math.PI * 2);
        const bend = r.range(-0.4, 0.4);
        ctx.strokeStyle = `rgba(110,95,70,${r.range(0.03, 0.08)})`;
        ctx.lineWidth = r.range(0.4, 1.1) * (h / 1080);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(
          x + Math.cos(a + bend) * len * 0.5, y + Math.sin(a + bend) * len * 0.5,
          x + Math.cos(a) * len, y + Math.sin(a) * len
        );
        ctx.stroke();
      }
      // 细颗粒：一块 256 的噪点平铺
      const tile = c2d.offscreen(256, 256);
      const ti = tile.ctx.createImageData(256, 256);
      const gr = wk.rng(seed + 13);
      for (let i = 0; i < ti.data.length; i += 4) {
        const v = gr() < 0.5 ? 0 : 255;
        ti.data[i] = ti.data[i + 1] = ti.data[i + 2] = v;
        ti.data[i + 3] = gr() * grain * 255;
      }
      tile.ctx.putImageData(ti, 0, 0);
      ctx.fillStyle = ctx.createPattern(tile.canvas, 'repeat');
      ctx.fillRect(0, 0, w, h);
    });
  };

  // ───────────────────────── 路径 ─────────────────────────

  /**
   * 用 Catmull-Rom 平滑经过控制点，并按弧长等距重采样。
   * @param {number[][]} pts 控制点 [[x,y], ...]（至少 2 个）
   * @param {number} spacing 采样间距（像素）
   * @returns {{pts: number[][], len: number[], total: number}} len 为累计弧长
   */
  c2d.smoothPath = function (pts, spacing = 2) {
    if (pts.length < 2) return { pts: pts.slice(), len: [0], total: 0 };
    const dense = [];
    const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = Math.max(4, Math.ceil(segLen / Math.max(1, spacing)));
      for (let k = 0; k < steps; k++) {
        const t = k / steps, t2 = t * t, t3 = t2 * t;
        dense.push([0, 1].map((j) =>
          0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)
        ));
      }
    }
    dense.push(pts[pts.length - 1].slice());
    // 等弧长重采样
    const out = [dense[0]];
    const len = [0];
    let acc = 0, carry = 0;
    for (let i = 1; i < dense.length; i++) {
      const a = dense[i - 1], b = dense[i];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let pos = spacing - carry;
      while (pos <= d) {
        const k = pos / d;
        out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
        acc += out.length > 1 ? spacing : 0;
        len.push(acc);
        pos += spacing;
      }
      carry = d - (pos - spacing);
    }
    const last = dense[dense.length - 1];
    const tail = out[out.length - 1];
    const dl = Math.hypot(last[0] - tail[0], last[1] - tail[1]);
    if (dl > 0.01) {
      out.push(last.slice());
      len.push(acc + dl);
    }
    return { pts: out, len, total: len[len.length - 1] };
  };

  function normals(pts) {
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l];
    });
  }

  // ───────────────────────── 毛笔笔触 ─────────────────────────

  /**
   * 毛笔笔触：起笔由细到粗、行笔有抖动、收笔收细，带洇边与飞白。
   * 画在离屏层上再以 multiply 叠到 ctx（墨"吃"进纸里，重叠处会更深）。
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number[][]} pts 控制点（会被平滑）
   * @param {object} o
   * @param {number}  o.width         基础笔宽（像素）
   * @param {string}  [o.color]       墨色，默认 '#1a1a1a'
   * @param {number}  [o.alpha=0.9]   整体不透明度
   * @param {number}  [o.progress=1]  0..1，只画出前面这部分（"写"出来的动画）
   * @param {number[]}[o.taper]       [起笔比例, 收笔比例]，默认 [0.12, 0.3]
   * @param {(u:number)=>number} [o.pressure] 沿笔画 u∈[0,1] 的压力倍数
   * @param {number}  [o.dry=0.25]    飞白程度 0..1（越往笔尾越干）
   * @param {number}  [o.bleed]       洇边模糊半径（像素），默认 width*0.35
   * @param {number}  [o.bristles=14] 笔毛数量
   * @param {number}  [o.jitter=0.1]  行笔粗细抖动
   * @param {number}  [o.seed=1]
   */
  c2d.brush = function (ctx, pts, o) {
    const width = o.width;
    const color = o.color || '#1a1a1a';
    const alpha = o.alpha ?? 0.9;
    const progress = wk.clamp(o.progress ?? 1);
    if (progress <= 0 || pts.length < 2) return;
    const [tin, tout] = o.taper || [0.12, 0.3];
    const dry = o.dry ?? 0.25;
    const bleed = o.bleed ?? width * 0.35;
    const N = o.bristles ?? 14;
    const jitter = o.jitter ?? 0.1;
    const seed = o.seed ?? 1;
    const pressure = o.pressure || (() => 1);
    const nz = wk.noise(seed);

    const path = c2d.smoothPath(pts, Math.max(0.75, width * 0.12));
    const total = path.total || 1;
    const cut = total * progress;
    let n = path.pts.findIndex((_, i) => path.len[i] > cut);
    if (n === -1) n = path.pts.length;
    if (n < 2) return;
    const P = path.pts.slice(0, n);
    const U = path.len.slice(0, n).map((l) => l / total);
    const Nn = normals(P);
    const W = U.map((u) => {
      const a = 0.18 + 0.82 * wk.smoothstep(0, tin, u);
      const b = 0.08 + 0.92 * wk.smoothstep(1, 1 - tout, u);
      return Math.max(0.3, width * a * b * pressure(u) * (1 + jitter * nz.n1(u * 7 + 3) + 0.045 * nz.n1(u * 41 + 9)));
    });

    // 包围盒 → 离屏层
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < P.length; i++) {
      x0 = Math.min(x0, P[i][0] - W[i]); y0 = Math.min(y0, P[i][1] - W[i]);
      x1 = Math.max(x1, P[i][0] + W[i]); y1 = Math.max(y1, P[i][1] + W[i]);
    }
    const pad = Math.ceil(bleed * 3 + 4);
    x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad);
    const s = scratch(x1 - x0 + pad, y1 - y0 + pad, 0);
    const g = s.ctx;
    g.translate(-x0, -y0);

    const outline = new Path2D();
    for (let i = 0; i < P.length; i++) {
      const x = P[i][0] + Nn[i][0] * W[i] * 0.5, y = P[i][1] + Nn[i][1] * W[i] * 0.5;
      i ? outline.lineTo(x, y) : outline.moveTo(x, y);
    }
    for (let i = P.length - 1; i >= 0; i--) {
      outline.lineTo(P[i][0] - Nn[i][0] * W[i] * 0.5, P[i][1] - Nn[i][1] * W[i] * 0.5);
    }
    // 起止圆头
    outline.closePath();

    // 1) 洇边
    if (bleed > 0.5) {
      g.filter = `blur(${bleed.toFixed(1)}px)`;
      g.fillStyle = c2d.rgba(color, 0.28);
      g.fill(outline);
      g.filter = 'none';
    }
    // 2) 湿润的笔芯：沿笔画方向用渐变表现"墨越来越少"
    const a = P[0], b = P[P.length - 1];
    const full = path.pts[path.pts.length - 1];
    const grad = g.createLinearGradient(a[0], a[1], full[0], full[1]);
    const core = 0.78;
    grad.addColorStop(0, c2d.rgba(color, core));
    grad.addColorStop(0.5, c2d.rgba(color, core * (1 - dry * 0.5)));
    grad.addColorStop(1, c2d.rgba(color, core * Math.max(0.05, 1 - dry * 1.2)));
    g.fillStyle = Math.hypot(full[0] - a[0], full[1] - a[1]) > 1 ? grad : c2d.rgba(color, core);
    g.fill(outline);
    // 3) 笔毛与飞白：每根笔毛有自己的含墨量，沿笔画逐渐"跑干"，
    //    干了的笔毛在笔芯上挖出一道顺着笔势的长白缝 —— 这就是飞白。
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const br = wk.rng(seed + 101);
    const hairs = [];
    for (let k = 0; k < N; k++) {
      const off = (k / (N - 1) - 0.5) * 0.94 + br.range(-0.025, 0.025);
      const ink = br.range(0.3, 1);
      const phase = br() * 100;
      const lw = Math.max(0.6, (width / N) * br.range(1.1, 1.9));
      const vis = U.map((u) => {
        const runOut = dry * Math.pow(u, 1.15) * 1.9 * (1 + 0.45 * nz.n1(u * 2.2 + phase));
        return runOut + 0.12 * dry * nz.n2(u * 26 + phase, k * 3.1) < ink;
      });
      hairs.push({ off, ink, lw, vis });
    }
    const runs = (h, want, cb) => {
      let open = false;
      g.beginPath();
      for (let i = 0; i < P.length; i++) {
        const x = P[i][0] + Nn[i][0] * W[i] * h.off, y = P[i][1] + Nn[i][1] * W[i] * h.off;
        if (h.vis[i] === want) {
          open ? g.lineTo(x, y) : g.moveTo(x, y);
          open = true;
        } else open = false;
      }
      cb();
    };
    if (dry > 0.03) {
      g.save();
      g.globalCompositeOperation = 'destination-out';
      for (const h of hairs) {
        g.lineWidth = h.lw * 1.15;
        g.strokeStyle = `rgba(0,0,0,${Math.min(1, 0.55 + dry * 0.6)})`;
        runs(h, false, () => g.stroke());
      }
      g.restore();
    }
    for (const h of hairs) {
      g.lineWidth = h.lw * 0.7;
      g.strokeStyle = c2d.rgba(color, 0.35 + 0.35 * h.ink);
      runs(h, true, () => g.stroke());
    }
    void b;
    // 叠回主画布
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(s.canvas, 0, 0, s.canvas.width, s.canvas.height, x0, y0, s.canvas.width, s.canvas.height);
    ctx.restore();
  };

  // ───────────────────────── 晕染面 ─────────────────────────

  /**
   * 晕染面：柔边填充 + 边缘一圈稍深的"水线"，可选纵向淡出（山脚入雾）。
   * @param {CanvasRenderingContext2D} ctx
   * @param {Path2D|number[][]} shape 闭合路径或多边形点
   * @param {object} o
   * @param {string} [o.color='#4d4d4d']
   * @param {number} [o.alpha=0.5]
   * @param {number} [o.blur=6]        柔边半径
   * @param {number} [o.edge=0.35]     水线强度 0..1
   * @param {number} [o.edgeWidth=2]
   * @param {number[]} [o.fade]        [yStart, yEnd]：从 yStart 到 yEnd 渐隐到透明
   * @param {number[]} [o.fadeLeft]    [x0, x1]：左端从透明渐显
   * @param {number[]} [o.fadeRight]   [x0, x1]：右端渐隐到透明
   * @param {number[]} [o.bounds]      [x, y, w, h] 离屏层范围，默认是当前变换下整幅画布覆盖的区域
   */
  c2d.wash = function (ctx, shape, o = {}) {
    const color = o.color || '#4d4d4d';
    const [bx, by, bw, bh] = o.bounds || washBounds(ctx, shape, o);
    const s = scratch(bw, bh, 1);
    const g = s.ctx;
    g.translate(-bx, -by);
    const p = shape instanceof Path2D ? shape : polyPath(shape, true);
    g.filter = `blur(${(o.blur ?? 6).toFixed(1)}px)`;
    g.fillStyle = c2d.rgba(color, o.alpha ?? 0.5);
    g.fill(p);
    const edge = o.edge ?? 0.35;
    if (edge > 0) {
      g.filter = `blur(${((o.edgeWidth ?? 2) * 0.6).toFixed(1)}px)`;
      g.strokeStyle = c2d.rgba(color, Math.min(1, (o.alpha ?? 0.5) * edge * 1.6));
      g.lineWidth = o.edgeWidth ?? 2;
      g.stroke(p);
    }
    g.filter = 'none';
    for (const [range, dir] of [[o.fadeLeft, 1], [o.fadeRight, -1]]) {
      if (!range) continue;
      g.globalCompositeOperation = 'destination-in';
      const gr = g.createLinearGradient(range[0], 0, range[1], 0);
      gr.addColorStop(0, `rgba(0,0,0,${dir > 0 ? 0 : 1})`);
      gr.addColorStop(1, `rgba(0,0,0,${dir > 0 ? 1 : 0})`);
      g.fillStyle = gr;
      g.fillRect(bx, by, bw, bh);
    }
    if (o.fade) {
      g.globalCompositeOperation = 'destination-in';
      const gr = g.createLinearGradient(0, o.fade[0], 0, o.fade[1]);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(bx, by, bw, bh);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(s.canvas, 0, 0, bw, bh, bx, by, bw, bh);
    ctx.restore();
  };

  // 离屏层面积上限（画布面积的倍数）。缩得很小时整幅画布换算回来会非常大，超过 Chromium 的画布上限
  const WASH_MAX_AREA = 4;

  // 包住一组点的矩形 [x, y, w, h]（向外取整）
  function boxOf(pts, pad = 0) {
    const x0 = Math.floor(Math.min(...pts.map((p) => p[0])) - pad);
    const y0 = Math.floor(Math.min(...pts.map((p) => p[1])) - pad);
    const x1 = Math.ceil(Math.max(...pts.map((p) => p[0])) + pad);
    const y1 = Math.ceil(Math.max(...pts.map((p) => p[1])) + pad);
    return [x0, y0, x1 - x0, y1 - y0];
  }

  // wash 的默认离屏范围：整幅画布在当前变换下覆盖的区域。
  // 镜头先 translate 再围绕原点画时，形状坐标有负数，不能直接用 [0, 0, 画布宽, 画布高]。
  // 变换不可逆（scale(0)）时退回整幅画布；范围过大时（缩得很小）改用多边形自己的外接框。
  function washBounds(ctx, shape, o) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const inv = ctx.getTransform().inverse();
    const corners = [[0, 0], [cw, 0], [0, ch], [cw, ch]].map(([x, y]) => inv.transformPoint(new DOMPoint(x, y)));
    const b = boxOf(corners.map((p) => [p.x, p.y]));
    if (!b.every(Number.isFinite)) return [0, 0, cw, ch];
    if (b[2] * b[3] <= WASH_MAX_AREA * cw * ch) return b;
    if (Array.isArray(shape) && shape.length) return boxOf(shape, (o.blur ?? 6) * 3 + (o.edgeWidth ?? 2));
    return [0, 0, cw, ch];
  }

  function polyPath(pts, close) {
    const p = new Path2D();
    pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
    if (close) p.closePath();
    return p;
  }
  c2d.polyPath = polyPath;

  /**
   * 用 1D fBm 生成一条山脊线。
   * @param {object} o
   * @param {number} o.x0  @param {number} o.x1  水平范围
   * @param {number} o.y   基线
   * @param {number} o.amp 起伏幅度（像素）
   * @param {number} [o.freq=1.5] 起伏频率（整段内的大约峰数）
   * @param {number[][]} [o.peaks]  额外的主峰：[[x中心比例0..1, 高度像素, 宽度比例], ...]
   * @param {number} [o.step=6]   采样间隔
   * @param {number} [o.rough=0.12] 细碎起伏
   * @param {number[]} [o.taper]  [左端, 右端] 收到地面的比例，如 [0, 0.12]
   * @param {number} [o.seed=1]
   * @returns {number[][]}
   */
  c2d.ridge = function (o) {
    const n = wk.noise(o.seed ?? 1);
    const step = o.step ?? 6;
    const out = [];
    for (let x = o.x0; x <= o.x1 + 0.1; x += step) {
      const u = (x - o.x0) / (o.x1 - o.x0);
      let h = (n.fbm1(u * (o.freq ?? 1.5) * 2 + 0.5, 5) * 0.5 + 0.5) * o.amp;
      for (const [c, ph, pw] of o.peaks || []) {
        // 主峰不要是光滑的钟形：用噪声扭曲峰形，并让峰顶偏向一侧
        const uu = u - c + 0.35 * pw * n.n1(u * 6 + c * 50);
        h += ph * Math.exp(-Math.pow(uu / (uu < 0 ? pw * 1.15 : pw * 0.85), 2));
      }
      h *= 1 + (o.rough ?? 0.12) * n.fbm1(u * 38 + 4, 3);
      // 两端收到地面，避免山体被"切断"
      const [el, er] = o.taper || [0, 0];
      if (el > 0) h *= wk.smoothstep(0, el, u);
      if (er > 0) h *= wk.smoothstep(1, 1 - er, u);
      out.push([x, o.y - h]);
    }
    return out;
  };

  // ───────────────────────── 雾 ─────────────────────────

  /**
   * 横向雾带：一串柔和椭圆，随时间缓慢漂移。用宣纸色（或背景色）画，能"遮"住下面的墨。
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} o
   * @param {number} o.y  @param {number} o.h   雾带中心与厚度
   * @param {number} [o.x0=0] @param {number} [o.x1=画宽]
   * @param {string} [o.color='#F2EDE3']
   * @param {number} [o.alpha=0.6]
   * @param {number} [o.t=0]      时间（秒）
   * @param {number} [o.drift=0]  漂移速度（像素/秒）
   * @param {number} [o.puffs=9]
   * @param {number} [o.seed=1]
   */
  c2d.mist = function (ctx, o) {
    const r = wk.rng(o.seed ?? 1);
    const x0 = o.x0 ?? 0, x1 = o.x1 ?? ctx.canvas.width;
    const span = x1 - x0;
    const puffs = o.puffs ?? 9;
    const color = o.color || '#F2EDE3';
    ctx.save();
    for (let i = 0; i < puffs; i++) {
      const baseX = x0 + ((i + r.range(-0.3, 0.3)) / puffs) * span * 1.3 - span * 0.15;
      const x = x0 + ((((baseX - x0) + (o.t ?? 0) * (o.drift ?? 0)) % (span * 1.3)) + span * 1.3) % (span * 1.3) - span * 0.15;
      const y = o.y + r.range(-0.25, 0.25) * o.h;
      const rx = r.range(0.18, 0.32) * span;
      const ry = o.h * r.range(0.35, 0.6);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(rx / ry, 1);
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
      const a = (o.alpha ?? 0.6) * r.range(0.6, 1);
      gr.addColorStop(0, c2d.rgba(color, a));
      gr.addColorStop(0.55, c2d.rgba(color, a * 0.55));
      gr.addColorStop(1, c2d.rgba(color, 0));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(0, 0, ry, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };

  // ───────────────────────── 文字 ─────────────────────────

  /**
   * 竖排文字，从上到下逐字"写"出（每个字自上而下显现，带淡淡洇边）。
   * 多列时从右往左排。
   * @param {CanvasRenderingContext2D} ctx
   * @param {string|string[]} text 字符串（单列）或字符串数组（多列，第一列在最右）
   * @param {object} o
   * @param {number} o.x  @param {number} o.y   第一列的中心 x、首字顶部 y
   * @param {number} o.size                    字号（像素）
   * @param {string} [o.family='Ma Shan Zheng']
   * @param {string} [o.color='#141414']
   * @param {number} [o.alpha=0.92]
   * @param {number} [o.gap=0.12]              字距（相对字号）
   * @param {number} [o.colGap=0.5]            列距（相对字号）
   * @param {number} [o.progress=1]            0..1 全部字的显现进度
   * @param {number} [o.bleed]                 洇边模糊，默认 size*0.03
   */
  c2d.verticalText = function (ctx, text, o) {
    const cols = Array.isArray(text) ? text : [text];
    const prog = wk.clamp(o.progress ?? 1);
    if (prog <= 0) return;
    const size = o.size;
    const step = size * (1 + (o.gap ?? 0.12));
    const colStep = size * (1 + (o.colGap ?? 0.5));
    const rows = Math.max(...cols.map((c) => [...c].length));
    // 写完之后整块缓存，后面的帧只贴图
    if (prog >= 1) {
      const pad = size;
      const w = (cols.length - 1) * colStep + size * 2 + pad * 2;
      const h = rows * step + pad * 2;
      const key = `vtext:${cols.join('|')}:${size}:${o.family}:${o.color}:${o.alpha}:${o.gap}:${o.colGap}`;
      const img = c2d.cached(key, w, h, (g) => {
        drawVertical(g, cols, { ...o, x: w - pad - size, y: pad }, 1);
      });
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(img, o.x - (w - pad - size), o.y - pad);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    drawVertical(ctx, cols, o, prog);
    ctx.restore();
  };

  function drawVertical(ctx, cols, o, progress) {
    const chars = [];
    cols.forEach((col, ci) => [...col].forEach((ch, ri) => chars.push({ ch, ci, ri })));
    const n = chars.length;
    const size = o.size;
    const step = size * (1 + (o.gap ?? 0.12));
    const colStep = size * (1 + (o.colGap ?? 0.5));
    const prog = progress * n;
    const color = o.color || '#141414';
    const bleed = o.bleed ?? size * 0.03;
    ctx.font = wk.font(o.family || 'Ma Shan Zheng', size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    chars.forEach((c, i) => {
      const k = wk.clamp(prog - i);
      if (k <= 0) return;
      const x = o.x - c.ci * colStep;
      const y = o.y + c.ri * step;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - size, y - size * 0.1, size * 2, size * 1.2 * wk.ease.sineOut(k));
      ctx.clip();
      ctx.globalAlpha = (o.alpha ?? 0.92) * 0.35;
      ctx.filter = `blur(${bleed.toFixed(1)}px)`;
      ctx.fillStyle = color;
      ctx.fillText(c.ch, x, y);
      ctx.filter = 'none';
      ctx.globalAlpha = o.alpha ?? 0.92;
      ctx.fillText(c.ch, x, y);
      ctx.restore();
    });
  }

  // ───────────────────────── 印章 ─────────────────────────

  /**
   * 白文方印（红底白字），边缘与印面带斑驳。progress 控制"盖"下去的过程：
   * 放大 1.08 → 1、透明 → 不透明，不回弹。
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} o
   * @param {number} o.x  @param {number} o.y  印章中心
   * @param {number} o.size                   边长（像素）
   * @param {string} o.text                   2 或 4 个字（右列先读，自上而下）
   * @param {string} [o.color='#B22C22']
   * @param {string} [o.family='Ma Shan Zheng']
   * @param {number} [o.progress=1]
   * @param {number} [o.seed=1]
   * @param {number} [o.rotate=0]             轻微倾斜（弧度）
   */
  c2d.seal = function (ctx, o) {
    const k = wk.clamp(o.progress ?? 1);
    if (k <= 0) return;
    const size = o.size;
    const pad = size * 0.3;
    const S = size + pad * 2;
    const key = `seal:${size}:${o.text}:${o.color}:${o.seed}:${o.family}`;
    const img = c2d.cached(key, S, S, (g) => {
      const r = wk.rng(o.seed ?? 1);
      const nz = wk.noise((o.seed ?? 1) + 5);
      // 粗糙的方形外框
      const pts = [];
      const side = size;
      const edgePts = 24;
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (let c = 0; c < 4; c++) {
        const [ax, ay] = corners[c], [bx, by] = corners[(c + 1) % 4];
        for (let i = 0; i < edgePts; i++) {
          const t = i / edgePts;
          const jx = nz.n1(c * 10 + t * 6) * side * 0.012;
          const jy = nz.n1(c * 10 + t * 6 + 40) * side * 0.012;
          pts.push([pad + (ax + (bx - ax) * t) * side + jx, pad + (ay + (by - ay) * t) * side + jy]);
        }
      }
      g.fillStyle = o.color || '#B22C22';
      g.fill(polyPath(pts, true));
      // 白文：把字挖掉
      g.globalCompositeOperation = 'destination-out';
      const chars = [...o.text];
      const fam = o.family || 'Ma Shan Zheng';
      const cells = chars.length === 4
        ? [[0.75, 0.27], [0.75, 0.73], [0.25, 0.27], [0.25, 0.73]]
        : chars.length === 2 ? [[0.5, 0.27], [0.5, 0.73]] : [[0.5, 0.5]];
      const fs = chars.length === 1 ? side * 0.78 : side * 0.44;
      g.font = wk.font(fam, fs, 'bold');
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#000';
      chars.forEach((ch, i) => {
        const [cx, cy] = cells[i] || [0.5, 0.5];
        g.save();
        g.translate(pad + cx * side, pad + cy * side);
        if (chars.length === 2) g.scale(1.55, 1);
        g.fillText(ch, 0, fs * 0.04);
        g.restore();
      });
      // 斑驳：随机小点挖掉一些红
      for (let i = 0; i < 90; i++) {
        g.globalAlpha = r.range(0.25, 0.9);
        g.beginPath();
        g.arc(pad + r() * side, pad + r() * side, r.range(0.4, 2.2) * (side / 80), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    });
    const e = wk.ease.cubicOut(k);
    const sc = 1.08 - 0.08 * e;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.rotate ?? 0);
    ctx.scale(sc, sc);
    ctx.globalAlpha *= Math.min(1, k * 1.6) * 0.92;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(img, -S / 2, -S / 2);
    ctx.restore();
  };
})();
