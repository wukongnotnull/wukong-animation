/* 带种子的噪声：2D simplex、1D 值噪声、分形叠加 fBm。
 *   const n = wk.noise(seed);
 *   n.n2(x, y)            → [-1,1]
 *   n.n1(x)               → [-1,1]  平滑 1D 噪声
 *   n.fbm2(x, y, oct=4)   → [-1,1]  约
 *   n.fbm1(x, oct=4)      → [-1,1]  约
 */
(function () {
  'use strict';
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const grad = [
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ];

  wk.noise = function (seed = 0) {
    const r = wk.rng(seed);
    const p = new Uint8Array(512);
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const vals = new Float32Array(256).map(() => r() * 2 - 1);

    function n2(xin, yin) {
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s);
      const j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const x0 = xin - (i - t);
      const y0 = yin - (j - t);
      const i1 = x0 > y0 ? 1 : 0;
      const j1 = x0 > y0 ? 0 : 1;
      const x1 = x0 - i1 + G2;
      const y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2;
      const y2 = y0 - 1 + 2 * G2;
      const ii = i & 255;
      const jj = j & 255;
      let n = 0;
      let tt = 0.5 - x0 * x0 - y0 * y0;
      if (tt > 0) { const g = grad[p[ii + p[jj]] & 7]; tt *= tt; n += tt * tt * (g[0] * x0 + g[1] * y0); }
      tt = 0.5 - x1 * x1 - y1 * y1;
      if (tt > 0) { const g = grad[p[ii + i1 + p[jj + j1]] & 7]; tt *= tt; n += tt * tt * (g[0] * x1 + g[1] * y1); }
      tt = 0.5 - x2 * x2 - y2 * y2;
      if (tt > 0) { const g = grad[p[ii + 1 + p[jj + 1]] & 7]; tt *= tt; n += tt * tt * (g[0] * x2 + g[1] * y2); }
      return 70 * n;
    }
    function n1(x) {
      const i = Math.floor(x);
      const f = x - i;
      const u = f * f * (3 - 2 * f);
      return vals[p[i & 255]] * (1 - u) + vals[p[(i + 1) & 255]] * u;
    }
    function fbm2(x, y, oct = 4, lac = 2, gain = 0.5) {
      let a = 0.5, f = 1, s = 0, norm = 0;
      for (let o = 0; o < oct; o++) { s += a * n2(x * f, y * f); norm += a; a *= gain; f *= lac; }
      return s / norm;
    }
    function fbm1(x, oct = 4, lac = 2, gain = 0.5) {
      let a = 0.5, f = 1, s = 0, norm = 0;
      for (let o = 0; o < oct; o++) { s += a * n1(x * f + o * 17.31); norm += a; a *= gain; f *= lac; }
      return s / norm;
    }
    return { n2, n1, fbm2, fbm1 };
  };
})();
