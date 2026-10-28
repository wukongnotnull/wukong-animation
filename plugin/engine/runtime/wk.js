/* wukong-animation 页面运行时：命名空间、镜头注册、逐帧调度。
 * 由浏览器类管线最先注入。所有工具包都挂在 window.wk 下。
 *
 * 镜头文件写法（详见 skills/director/specs/SHOT.md）：
 *   wk.shot({
 *     setup(s)            { return { ...只依赖种子的预计算... } },   // 可选，每镜只跑一次
 *     render(ctx, t, s)   { ...只依赖 t 和 s 画出这一帧... }          // 必须是 t 的纯函数
 *   });
 */
(function () {
  'use strict';
  const cfg = window.__WK_CONFIG;
  const wk = (window.wk = window.wk || {});
  wk.config = cfg;
  wk.version = cfg.engineVersion;

  const shots = {};
  let current = null;

  wk.shot = function (def) {
    if (!current) throw new Error('wk.shot() 只能在镜头文件里调用');
    if (typeof def.render !== 'function') throw new Error(`镜头 ${current} 缺少 render(ctx, t, s)`);
    shots[current] = { def, state: undefined, ready: false };
  };

  /** 字体：返回 ctx.font 可直接使用的字符串，自动带上 fallback。 */
  wk.font = function (family, px, weight = '') {
    const stack = (cfg.fonts && cfg.fonts[family]) || `'${family}', serif`;
    return `${weight ? weight + ' ' : ''}${px}px ${stack}`;
  };

  // —— 确定性：禁止镜头使用 Math.random ——
  let warned = false;
  const nativeRandom = Math.random;
  Math.random = function () {
    if (!warned) {
      warned = true;
      console.warn('[wk] 检测到 Math.random()，这会让画面不可复现。请改用 s.rng() 或 wk.rng(seed)。');
    }
    return wk._frameRng ? wk._frameRng() : nativeRandom();
  };

  function hashStr(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    return h >>> 0;
  }
  wk.hashStr = hashStr;

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d', { alpha: false });
  wk.canvas = canvas;
  wk.ctx = ctx;

  // 声音同步点：film.json 的 cues（全片时间，秒）→ 镜头内的本地时间
  const cues = cfg.cues || {};
  function cueOf(name, meta, i) {
    const c = cues[name];
    if (!c) throw new Error(`没有声音同步点 "${name}"。已有：${Object.keys(cues).join('、') || '（无）'}。先运行 wka soundtrack`);
    return c[i] - meta.start;
  }
  // 逐字同步点：wka soundtrack 给 voices[].chars 为 true 的句子写出 名#1、名#2……
  function charsOf(name, meta) {
    const out = [];
    for (let k = 1; cues[`${name}#${k}`]; k++) out.push({ in: cues[`${name}#${k}`][0] - meta.start, out: cues[`${name}#${k}`][1] - meta.start });
    if (!out.length) throw new Error(`没有 "${name}" 的逐字同步点。在 film.json 的 voices 里给这一句加 "chars": true，再运行 wka soundtrack`);
    return out;
  }

  function baseState(id, meta) {
    return {
      /** 同步点入点（相对本镜头，秒）：wk.seg(t, s.cueIn('第二句'), s.cueOut('第二句')) */
      cueIn: (name) => cueOf(name, meta, 0),
      /** 同步点出点（相对本镜头，秒） */
      cueOut: (name) => cueOf(name, meta, 1),
      /** 逐字同步点（相对本镜头，秒）：[{ in, out }, …]，一个字一项，标点不算 */
      cueChars: (name) => charsOf(name, meta),
      id,
      W: cfg.W,
      H: cfg.H,
      u: cfg.H / cfg.designH, // 设计单位：按 1080p 设计的像素 × s.u
      fps: cfg.fps,
      T: meta.duration,
      start: meta.start,
      seed: (cfg.seed ^ hashStr(id)) >>> 0,
    };
  }

  // 由管线调用
  wk._beginShot = function (id) {
    current = id;
  };
  wk._endShot = function () {
    current = null;
  };
  wk._hasShot = (id) => !!shots[id];

  wk._renderAt = function (id, meta, t, frame) {
    const shot = shots[id];
    if (!shot) throw new Error(`镜头 ${id} 未注册（文件里是否调用了 wk.shot?）`);
    const s = baseState(id, meta);
    if (!shot.ready) {
      shot.state = (shot.def.setup && shot.def.setup({ ...s, rng: wk.rng(s.seed) })) || {};
      shot.ready = true;
    }
    Object.assign(s, {
      t,
      p: Math.min(1, Math.max(0, t / s.T)),
      gt: s.start + t,
      frame,
      state: shot.state,
      // 每帧独立、可复现的随机数（只用于逐帧抖动类效果）
      rng: wk.rng((s.seed + Math.imul(frame + 1, 2654435761)) >>> 0),
    });
    wk._frameRng = s.rng;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, s.W, s.H);
    shot.def.render(ctx, t, s);
    wk._frameRng = null;
  };

  wk._grab = function (type = 'image/jpeg', quality = 0.94) {
    return canvas.toDataURL(type, quality).split(',')[1];
  };
})();
