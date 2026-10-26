// 找出音轨里有声音的区间：剪映草稿里只放这些片段，不放整段静音。
import { spawnSync } from 'node:child_process';

const NOISE_DB = -50; // 低于此电平算静音
const MIN_SILENCE = 1; // 秒；更短的停顿不切，免得一段乐句被切碎
const PAD = 0.1; // 秒；每段前后留白，别切掉起音和余音

const ms = (sec) => +sec.toFixed(3);

/** 解析 ffmpeg silencedetect 的输出；末尾没收尾的静音算到文件结束。 */
export function parseSilences(stderr, duration) {
  const out = [];
  for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const t = Math.max(0, parseFloat(m[2]));
    if (m[1] === 'start') out.push({ start: t, end: duration });
    else if (out.length) out[out.length - 1].end = t;
  }
  return out;
}

/** 静音区间 → 有声音的区间（前后各留 pad，裁到文件范围内，相接的合并）。 */
export function soundRanges(silences, duration, { pad = PAD } = {}) {
  const ranges = [];
  let cursor = 0;
  for (const s of [...silences, { start: duration, end: duration }]) {
    if (s.start > cursor) {
      const r = { start: ms(Math.max(0, cursor - pad)), end: ms(Math.min(duration, s.start + pad)) };
      const last = ranges[ranges.length - 1];
      if (last && r.start <= last.end) last.end = r.end;
      else ranges.push(r);
    }
    cursor = Math.max(cursor, s.end);
  }
  return ranges;
}

/** 对一个音频文件做静音检测，返回有声音的区间（秒，相对文件开头）。 */
export function detectSoundRanges(file, duration) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', `silencedetect=noise=${NOISE_DB}dB:d=${MIN_SILENCE}`, '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`静音检测失败：${file}\n${(r.stderr || '').slice(-400)}`);
  return soundRanges(parseSilences(r.stderr, duration), duration);
}
