// 母带响度：两遍处理（先测量，再按测量值线性应用 loudnorm）。单遍 loudnorm 只能靠估计，目标 -14 实测会落到 -15 左右。
// 测量用 ebur128 而不是 loudnorm 自己的第一遍：片子只有十几秒时，loudnorm 测出的整体响度会偏 0.5–1 LU。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { run } from '../core/ffmpeg.mjs';

export const TRUE_PEAK = -1.5;
export const LRA = 11;
const SILENT = -70; // ebur128 对静音报 -70 LUFS

/**
 * ebur128 测整体响度、门限、响度范围、真峰值。
 * @returns {{i: number, thresh: number, lra: number, tp: number}}
 */
export function measureLoudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const summary = (r.stderr || '').split('Summary:').at(-1);
  const num = (re) => {
    const m = summary.match(re);
    return m ? (m[1] === '-inf' ? -Infinity : +m[1]) : NaN;
  };
  const stats = { i: num(/I:\s+(-?[\d.]+|-inf) LUFS/), thresh: num(/Threshold:\s+(-?[\d.]+|-inf) LUFS/), lra: num(/LRA:\s+(-?[\d.]+|-inf) LU/), tp: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/) };
  if (r.status !== 0 || Number.isNaN(stats.i)) throw new Error(`响度测量失败：${(r.stderr || r.error?.message || '').slice(-600)}`);
  return stats;
}

/**
 * 把 src 的整体响度标准化到 target LUFS（真峰值 -1.5 dBTP）写到 dest（48 kHz）。
 * 静音时原样拷贝。线性增益会让真峰值超标、或响度范围超过 LRA 时，loudnorm 自己退回动态模式。
 * @returns {Promise<{output: number|null}>} output：标准化后复测的整体响度；没做标准化时为 null
 */
export async function normalizeLoudness(src, dest, target) {
  const m = measureLoudness(src);
  if (!(m.i > SILENT) || !Number.isFinite(m.tp)) {
    fs.copyFileSync(src, dest);
    return { output: null };
  }
  const apply = `loudnorm=I=${target}:TP=${TRUE_PEAK}:LRA=${LRA}:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:linear=true`;
  await run(['-i', src, '-af', apply, '-ar', '48000', dest]).catch((e) => {
    throw new Error(`响度应用失败：${e.message}`);
  });
  return { output: measureLoudness(dest).i };
}
