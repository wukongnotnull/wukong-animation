// 零依赖的小型合成器：写配乐 / 环境声 / 音效用，输出 48kHz 立体声 WAV。
// 片子的 audio/build.mjs 会拿到这个模块，用它生成原创配乐（不涉及任何采样版权）。
//
//   const buf = synth.buffer(15);
//   synth.qin(buf, { at: 0.5, note: 'D3', dur: 6 });     // 古琴式拨弦（带吟揉）
//   synth.water(buf, { from: 0, to: 15, gain: 0.25 });   // 流水环境声
//   synth.knock(buf, { at: 14.1 });                      // 印章落下"笃"
//   synth.bed(buf, { from: 0, to: 15, gain: 0.5 });     // 口播片的铺底背景音乐
//   synth.reverb(buf, { mix: 0.3, size: 0.8 });
//   synth.writeWav(buf, 'audio/generated/score.wav');
import fs from 'node:fs';
import path from 'node:path';

export const SR = 48000;

/** 创建一段静音缓冲。 */
export function buffer(seconds, sr = SR) {
  const n = Math.ceil(seconds * sr);
  return { sr, L: new Float32Array(n), R: new Float32Array(n), seconds };
}

/** 带种子的随机数（与页面运行时同一算法）。 */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTE = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
/** 'A4' / 'D#3' / 'Bb2' → 频率（Hz）。 */
export function freq(note) {
  if (typeof note === 'number') return note;
  const m = note.match(/^([A-G])([#b]?)(-?\d)$/);
  if (!m) throw new Error(`无法解析音名 ${note}`);
  const semi = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, semi / 12);
}

function add(buf, i, v, pan) {
  if (i < 0 || i >= buf.L.length) return;
  buf.L[i] += v * Math.cos((pan + 1) * Math.PI * 0.25);
  buf.R[i] += v * Math.sin((pan + 1) * Math.PI * 0.25);
}

/**
 * 古琴式拨弦：加法合成，高次谐波衰减更快，带轻微非谐性、拨弦噪声和"吟"（延迟出现的颤音）。
 * @param {object} o
 * @param {number} o.at    开始时间（秒）
 * @param {string|number} o.note 音名或频率
 * @param {number} [o.dur=5]     余音长度
 * @param {number} [o.gain=0.35]
 * @param {number} [o.pan=0]     -1 左 … 1 右
 * @param {number} [o.vibrato=0.6]  吟揉深度（半音的比例）
 * @param {number} [o.slide=0]   滑音：向上/向下滑动的半音数（"绰""注"）
 * @param {number} [o.bright=0.5] 0..1 音色明暗
 */
export function qin(buf, o) {
  const f0 = freq(o.note);
  const dur = o.dur ?? 5;
  const gain = o.gain ?? 0.35;
  const pan = o.pan ?? 0;
  const vib = o.vibrato ?? 0.6;
  const slide = o.slide ?? 0;
  const bright = o.bright ?? 0.5;
  const sr = buf.sr;
  const start = Math.floor(o.at * sr);
  const n = Math.floor(dur * sr);
  const H = 9;
  const amps = Array.from({ length: H }, (_, h) => Math.pow(1 / (h + 1), 1.6 - bright * 0.8) * (h === 0 ? 1 : 0.8));
  const decays = Array.from({ length: H }, (_, h) => (1.4 + h * (1.2 + (1 - bright))) / dur * 3);
  const phases = new Float64Array(H);
  const r = rng(Math.floor(f0 * 1000));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // 滑音在前 0.35s 内完成；吟揉在 0.6s 后渐入
    const sl = slide ? slide * (1 - Math.min(1, t / 0.35)) : 0;
    const vibAmt = vib * Math.min(1, Math.max(0, (t - 0.6) / 0.8));
    const semis = -sl + vibAmt * 0.25 * Math.sin(2 * Math.PI * 4.6 * t);
    const f = f0 * Math.pow(2, semis / 12);
    let v = 0;
    for (let h = 0; h < H; h++) {
      const fh = f * (h + 1) * (1 + 0.0009 * h * h);
      if (fh > sr / 2) break;
      phases[h] += (2 * Math.PI * fh) / sr;
      v += amps[h] * Math.exp(-decays[h] * t) * Math.sin(phases[h]);
    }
    const attack = Math.min(1, t / 0.004);
    const release = Math.min(1, (dur - t) / 0.25);
    // 拨弦瞬间的指甲噪声
    const pluck = t < 0.03 ? (r() * 2 - 1) * (1 - t / 0.03) * 0.25 : 0;
    add(buf, start + i, (v * 0.22 + pluck) * gain * attack * release, pan);
  }
}

/**
 * 流水声：粉红噪声经低通，缓慢起伏，偶有水滴。
 * @param {object} o
 * @param {number} o.from @param {number} o.to
 * @param {number} [o.gain=0.2]
 * @param {number} [o.fade=1.5] 淡入淡出（秒）
 * @param {number} [o.drops=0.6] 每秒水滴数
 * @param {number} [o.seed=7]
 */
export function water(buf, o) {
  const sr = buf.sr;
  const r = rng(o.seed ?? 7);
  const gain = o.gain ?? 0.2;
  const fade = o.fade ?? 1.5;
  const a = Math.floor(o.from * sr), b = Math.min(buf.L.length, Math.floor(o.to * sr));
  let b0 = 0, b1 = 0, b2 = 0, lpL = 0, lpR = 0, lfo = r() * 10;
  for (let i = a; i < b; i++) {
    const t = (i - a) / sr;
    const w = r() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    const pink = (b0 + b1 + b2 + w * 0.1848) * 0.12;
    const env = Math.min(1, t / fade, (o.to - o.from - t) / fade);
    const swell = 0.65 + 0.35 * Math.sin(2 * Math.PI * 0.13 * t + lfo) * Math.sin(2 * Math.PI * 0.07 * t);
    lpL += (pink - lpL) * 0.08;
    lpR += (pink * 0.9 + (r() * 2 - 1) * 0.02 - lpR) * 0.07;
    buf.L[i] += lpL * gain * env * swell * 3;
    buf.R[i] += lpR * gain * env * swell * 3;
  }
  const nDrops = Math.floor((o.to - o.from) * (o.drops ?? 0.6));
  for (let k = 0; k < nDrops; k++) {
    const at = o.from + fade + r() * Math.max(0.1, o.to - o.from - fade * 2);
    const f = 900 + r() * 1400;
    const pan = r() * 1.6 - 0.8;
    const s = Math.floor(at * sr);
    for (let i = 0; i < sr * 0.08; i++) {
      const t = i / sr;
      add(buf, s + i, Math.sin(2 * Math.PI * f * (1 + t * 6) * t) * Math.exp(-t * 60) * gain * 0.35, pan);
    }
  }
}

/** 短促的"笃"（木质 / 印章落下）。 */
export function knock(buf, o) {
  const sr = buf.sr;
  const s = Math.floor(o.at * sr);
  const gain = o.gain ?? 0.5;
  const r = rng(o.seed ?? 3);
  for (let i = 0; i < sr * 0.25; i++) {
    const t = i / sr;
    const body = Math.sin(2 * Math.PI * (150 - t * 160) * t) * Math.exp(-t * 28);
    const click = t < 0.006 ? (r() * 2 - 1) * (1 - t / 0.006) : 0;
    add(buf, s + i, (body * 0.8 + click * 0.4) * gain, o.pan ?? 0);
  }
}

// ---------- 铺底音乐（移植自 wk-motion-graphics 的 make_sounds.py） ----------
// 96 BPM，Fmaj7 Em7 Dm7 Cmaj7 循环；前 4 小节只有 pad + bass，之后 8 小节一循环（加鼓和琶音）。
const BED_BAR = (4 * 60) / 96;
const BED_CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
const BED_ROOTS = [41, 40, 38, 36];
const BED_PEAK = 0.8 * 0.89; // 源脚本每段 gain 0.8 × 0.89 / 峰值
const midi = (m) => 440 * 2 ** ((m - 69) / 12);

/** 生成 bars 小节铺底音乐（单声道），峰值归一到 BED_PEAK。 */
function bedSection(bars, { drums, arp }, sr, r) {
  const TAU = 2 * Math.PI;
  const beat = BED_BAR / 4;
  const n = (sec) => Math.floor(sec * sr);
  const out = new Float32Array(n(bars * BED_BAR));
  const put = (start, len, fn) => {
    for (let i = 0; i < len && start + i < out.length; i++) out[start + i] += fn(i, i / sr);
  };
  for (let b = 0; b < bars; b++) {
    const chord = BED_CHORDS[b % 4];
    const bar0 = b * BED_BAR;
    // pad：正弦叠加 + 轻微失谐，缓起缓收
    const padLen = n(BED_BAR + 0.4);
    const padSec = padLen / sr;
    for (const m of chord) {
      const f = midi(m);
      put(n(bar0), padLen, (i, t) => (Math.sin(TAU * f * t) + Math.sin(TAU * (f + 0.6) * t) * 0.7 + 0.18 * Math.sin(TAU * 2 * f * t)) * Math.min(1, t / 0.6) * Math.min(1, (padSec - t) / 0.5) * 0.06);
    }
    // bass：第 1、2.5、3 拍
    const fb = midi(BED_ROOTS[b % 4]);
    for (const at of [0, 1.5, 2]) {
      put(n(bar0 + at * beat), n(beat * (at === 0 ? 1.4 : 0.9)), (i, t) => Math.tanh(Math.sin(TAU * fb * t) * 1.4) * Math.exp(-t * 2.2) * Math.min(1, t / 0.01) * 0.22);
    }
    if (drums) {
      for (const at of [0, 2, 2.5]) {
        let ph = 0;
        put(n(bar0 + at * beat), n(0.35), (i, t) => {
          ph += (TAU * (45 + 75 * Math.exp(-t * 28))) / sr;
          return Math.sin(ph) * Math.exp(-t * 9) * 0.45;
        });
      }
      for (const at of [1, 3]) {
        // 军鼓：两个一阶低通相减得到带通噪声
        const lo = 1 - Math.exp((-TAU * 1200) / sr), hi = 1 - Math.exp((-TAU * 4500) / sr);
        let ylo = 0, yhi = 0;
        put(n(bar0 + at * beat), n(0.2), (i, t) => {
          const x = r() * 2 - 1;
          ylo += lo * (x - ylo);
          yhi += hi * (x - yhi);
          return (yhi - ylo) * Math.exp(-t * 22) * 0.5;
        });
      }
      for (let e = 0; e < 8; e++) {
        // 踩镲：一阶高通噪声
        const a = 1 - Math.exp((-TAU * 7000) / sr);
        const amp = e % 2 ? 0.07 : 0.04;
        let y = 0;
        put(n(bar0 + (e * beat) / 2), n(0.05), (i, t) => {
          const x = r() * 2 - 1;
          y += a * (x - y);
          return (x - y) * Math.exp(-t * 70) * amp;
        });
      }
    }
    if (arp) {
      [0, 2, 1, 3, 2, 1, 3, 2].forEach((idx, k) => {
        const f = midi(chord[idx] + 12);
        put(n(bar0 + (k * beat) / 2), n(0.5), (i, t) => (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 3 * f * t)) * Math.exp(-t * 7) * 0.05);
      });
    }
  }
  let p = 1e-9;
  for (const v of out) p = Math.max(p, Math.abs(v));
  for (let i = 0; i < out.length; i++) out[i] *= BED_PEAK / p;
  return out;
}

/**
 * 铺底背景音乐（口播片用，可随人声闪避：返回音轨时标 duck: true）。
 * 写在 from–to 之间：开头淡入 1.5 秒，结尾淡出 3 秒，峰值约 0.71 × gain。
 */
export function bed(buf, { from = 0, to = buf.seconds, gain = 1, seed = 7 } = {}) {
  const sr = buf.sr;
  const r = rng(seed);
  const intro = bedSection(4, { drums: false, arp: false }, sr, r);
  const loop = bedSection(8, { drums: true, arp: true }, sr, r);
  const s0 = Math.floor(from * sr);
  const len = Math.min(Math.floor(to * sr), buf.L.length) - s0;
  const fadeIn = 1.5 * sr, fadeOut = 3 * sr;
  for (let i = 0; i < len; i++) {
    const v = i < intro.length ? intro[i] : loop[(i - intro.length) % loop.length];
    const env = Math.min(1, i / fadeIn, (len - i) / fadeOut);
    buf.L[s0 + i] += v * env * gain;
    buf.R[s0 + i] += v * env * gain;
  }
}

/** Schroeder 混响（4 梳状 + 2 全通），原地处理。 */
export function reverb(buf, { mix = 0.25, size = 0.75, damp = 0.4 } = {}) {
  const sr = buf.sr;
  const combs = [1557, 1617, 1491, 1422].map((d) => Math.floor((d * sr) / 44100));
  const aps = [225, 556].map((d) => Math.floor((d * sr) / 44100));
  for (const [ch, off] of [[buf.L, 0], [buf.R, 23]]) {
    const dry = Float32Array.from(ch);
    const wet = new Float32Array(ch.length);
    for (const d0 of combs) {
      const d = d0 + off;
      const line = new Float32Array(d);
      let idx = 0, lp = 0;
      for (let i = 0; i < ch.length; i++) {
        const y = line[idx];
        lp = y * (1 - damp) + lp * damp;
        line[idx] = dry[i] + lp * (0.7 + size * 0.28);
        wet[i] += y * 0.25;
        idx = (idx + 1) % d;
      }
    }
    for (const d0 of aps) {
      const d = d0 + off;
      const line = new Float32Array(d);
      let idx = 0;
      for (let i = 0; i < ch.length; i++) {
        const b = line[idx];
        const y = -wet[i] + b;
        line[idx] = wet[i] + b * 0.5;
        wet[i] = y;
        idx = (idx + 1) % d;
      }
    }
    for (let i = 0; i < ch.length; i++) ch[i] = dry[i] * (1 - mix) + wet[i] * mix;
  }
}

/** 写 16-bit 立体声 WAV；自动做峰值保护。 */
export function writeWav(buf, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let peak = 1e-9;
  for (let i = 0; i < buf.L.length; i++) peak = Math.max(peak, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  const scale = peak > 0.98 ? 0.98 / peak : 1;
  const n = buf.L.length;
  const out = Buffer.alloc(44 + n * 4);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + n * 4, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(buf.sr, 24);
  out.writeUInt32LE(buf.sr * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf.L[i] * scale)) * 32767), 44 + i * 4);
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf.R[i] * scale)) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, out);
  return file;
}
