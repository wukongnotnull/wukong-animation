/* webgl 工具包 —— 挂在 wk.gl 下。
 * 用法：
 *   const fx = wk.gl.shader(fragSource, { width, height });
 *   const canvas = fx.render({ u_time: t, u_center: [x, y] });   // 返回离屏 canvas
 *   ctx.drawImage(canvas, 0, 0);
 * 片元着色器里自动可用：
 *   uniform vec2 u_res;   varying vec2 v_uv;（0..1，左上为原点）
 *   以及 wk.gl.chunks.noise 提供的 snoise(vec2) / fbm(vec2, int)。
 * 输出请用"预乘 alpha"：gl_FragColor = vec4(rgb * a, a)。
 * 注意：返回的 canvas 是共享的，下一次 render 会覆盖它 —— 请立即 drawImage。
 */
(function () {
  'use strict';
  const gl_ = (wk.gl = {});

  const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

  /** 可在 shader 里 #include 的 GLSL 片段（用 {{noise}} 占位）。 */
  gl_.chunks = {
    noise: `
vec3 _p3(vec3 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = _p3(_p3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * snoise(p); n += a; p *= 2.03; a *= 0.5; }
  return s / n;
}`,
  };

  // 整个页面只用一个 WebGL 上下文：尺寸不同就调整画布大小（编译好的程序会保留）。
  // 每种尺寸各建一个上下文会很快超过浏览器上限（约 16 个），旧上下文会被强制回收。
  let shared = null;
  function getContext(w, h) {
    if (!shared) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
      if (!gl) throw new Error('WebGL 不可用（无头浏览器需 --use-angle=swiftshader）');
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      shared = { canvas, gl, programs: new Map() };
    }
    if (shared.canvas.width !== w || shared.canvas.height !== h) {
      shared.canvas.width = w;
      shared.canvas.height = h;
    }
    return shared;
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n');
      throw new Error(`GLSL 编译失败：${log}\n${numbered}`);
    }
    return s;
  }

  /**
   * 创建一个全屏 shader 效果。
   * @param {string} frag 片元着色器源码（可含 {{noise}} 占位）
   * @param {{width:number, height:number}} size
   * @returns {{render: (uniforms?: Record<string, number|number[]>) => HTMLCanvasElement, canvas: HTMLCanvasElement}}
   */
  gl_.shader = function (frag, { width, height }) {
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    const c = getContext(w, h);
    const gl = c.gl;
    const src = 'precision highp float;\nuniform vec2 u_res;\nvarying vec2 v_uv;\n' +
      frag.replace(/\{\{(\w+)\}\}/g, (_, k) => gl_.chunks[k] || '');
    let prog = c.programs.get(src);
    if (!prog) {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, src));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('GLSL 链接失败：' + gl.getProgramInfoLog(prog));
      prog._loc = {};
      c.programs.set(src, prog);
    }
    const loc = (name) => (name in prog._loc ? prog._loc[name] : (prog._loc[name] = gl.getUniformLocation(prog, name)));
    return {
      canvas: c.canvas,
      render(uniforms = {}) {
        getContext(w, h); // 共享画布可能被别的尺寸改过
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog);
        const a = gl.getAttribLocation(prog, 'a_pos');
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(loc('u_res'), w, h);
        for (const [k, v] of Object.entries(uniforms)) {
          const l = loc(k);
          if (l === null) continue;
          if (typeof v === 'number') gl.uniform1f(l, v);
          else if (v.length === 2) gl.uniform2fv(l, v);
          else if (v.length === 3) gl.uniform3fv(l, v);
          else if (v.length === 4) gl.uniform4fv(l, v);
        }
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        return c.canvas;
      },
    };
  };

  /** 把 "#rrggbb" 转成 [r,g,b]（0..1），方便传 uniform。 */
  gl_.color = function (hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
})();
