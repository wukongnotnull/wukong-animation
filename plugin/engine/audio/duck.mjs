// 闪避：背景音乐在人声下压低，停顿时回来（移植自 wk-motion-graphics 的 Soundtrack.tsx）。
// 源工程说话时 0.24、停顿时 0.5，提前 6 帧下压、说完 14 帧回升（30 fps）；这里换成相对比例和秒。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SR, buffer, writeWav } from './synth.mjs';

export const DUCK_DEPTH = 0.48; // 0.24 / 0.5
export const DUCK_ATTACK = 0.2; // 6 帧
export const DUCK_RELEASE = 0.47; // 14 帧

/**
 * 增益包络：说话中 DUCK_DEPTH，停顿 1；开口前 DUCK_ATTACK 秒线性压下，说完 DUCK_RELEASE 秒线性回升，重叠取最深。
 * @param {[number, number][]} intervals 人声区间（秒）
 * @returns {Float32Array}
 */
export function duckEnvelope(intervals, seconds, sr = SR) {
  const duck = new Float32Array(Math.ceil(seconds * sr)); // 0 = 不压，1 = 压到底
  for (const [a, b] of intervals) {
    const from = Math.max(0, Math.floor((a - DUCK_ATTACK) * sr));
    const to = Math.min(duck.length, Math.ceil((b + DUCK_RELEASE) * sr));
    for (let i = from; i < to; i++) {
      const t = i / sr;
      const d = Math.min(1, (t - (a - DUCK_ATTACK)) / DUCK_ATTACK, (b + DUCK_RELEASE - t) / DUCK_RELEASE);
      if (d > duck[i]) duck[i] = d;
    }
  }
  return duck.map((d) => 1 - (1 - DUCK_DEPTH) * d);
}

/** 读成立体声 48 kHz 浮点。 */
function decodeStereo(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`闪避：读不了 ${file}（${r.error?.message || String(r.stderr).slice(-400)}）`);
  const all = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length));
  const buf = buffer(all.length / 2 / SR);
  for (let i = 0; i < all.length / 2; i++) {
    buf.L[i] = all[2 * i];
    buf.R[i] = all[2 * i + 1];
  }
  return buf;
}

/**
 * 把音轨按人声闪避后写到 dest。intervals 用全片时间，start 是这条音轨在全片里的起点。
 */
export function duckFile(src, dest, intervals, { start = 0 } = {}) {
  const buf = decodeStereo(src);
  const env = duckEnvelope(intervals.map(([a, b]) => [a - start, b - start]), buf.L.length / SR);
  for (let i = 0; i < buf.L.length; i++) {
    buf.L[i] *= env[i];
    buf.R[i] *= env[i];
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  return writeWav(buf, dest);
}
