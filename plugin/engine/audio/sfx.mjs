// 录音音效库：风格在 style.json 的 sfx 字段指向一份清单（名字 → 来源、限长、电平），
// 音频按需下载到 ~/.wukong-animation/cache/sfx/<风格>/，处理后供 audio/build.mjs 按名字放。
// 免版税库（如 Mixkit）的许可通常允许用在视频里、不允许再分发文件本身，所以插件只带清单、不带音频。
//
//   sfx.place(buf, 'ding', { at: cues['要点'][0] });   // 在第几秒放哪个音效
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SFX_CACHE_DIR } from '../core/paths.mjs';
import { run } from '../core/ffmpeg.mjs';
import { SR } from './synth.mjs';

const FADE_SEC = 0.06;
const PEAK_DB = -1;
const FPS = 30; // 密度检查按 30 fps 判"同一帧"
const DING = 'ding'; // 每镜最多一个"叮"
const NO_CURL = '没有找到 curl';

/**
 * 读风格的音效清单；风格没写 sfx 时返回 null。
 * @returns {{styleId: string, file: string, dir: string, license: string, base: string, sounds: Record<string, object>} | null}
 */
export function loadSfxLibrary(style, { cacheDir = path.join(SFX_CACHE_DIR, style.id) } = {}) {
  if (!style.sfx) return null;
  const file = path.join(style.dir, style.sfx);
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { styleId: style.id, file, dir: cacheDir, license: spec.license, base: spec.base, sounds: spec.sounds };
}

export const sfxUrl = (lib, name) => {
  const s = lib.sounds[name];
  return `${lib.base}/${s.id}/${s.id}.${s.ext}`;
};

const rawFile = (lib, name) => path.join(lib.dir, 'raw', `${lib.sounds[name].id}.${lib.sounds[name].ext}`);
const preparedFile = (lib, name) => path.join(lib.dir, `${name}.wav`);

function peakDb(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (r.stderr || '').match(/max_volume: (-?[\d.]+) dB/);
  if (!m) throw new Error(`测不出峰值：${file}\n${(r.stderr || '').slice(-400)}`);
  return +m[1];
}

/** 去前导静音 → 限长 maxSeconds → 末尾 60 ms 淡出 → 48 kHz 单声道 → 峰值拉到 -1 dBFS。 */
export async function prepareSfx(src, dest, maxSeconds) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest.replace(/\.wav$/, '.tmp.wav');
  // 先写到 .part 再改名：中途失败不会留下比原始文件新、却不完整的 <名字>.wav（否则下次不会重做）
  const part = dest.replace(/\.wav$/, '.part.wav');
  const fadeStart = Math.max(0, maxSeconds - FADE_SEC);
  try {
    await run(['-i', src, '-af', `silenceremove=start_periods=1:start_threshold=-50dB,atrim=0:${maxSeconds},afade=t=out:st=${fadeStart}:d=${FADE_SEC}`, '-ac', '1', '-ar', String(SR), tmp]);
    const gain = PEAK_DB - peakDb(tmp);
    await run(['-i', tmp, '-af', `volume=${gain.toFixed(2)}dB`, '-ar', String(SR), part]);
    fs.renameSync(part, dest);
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(part, { force: true });
  }
  return dest;
}

function curl(args) {
  const r = spawnSync('curl', ['-fsSL', '--connect-timeout', '10', '--max-time', '60', '-A', 'Mozilla/5.0', ...args], { encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') throw new Error(NO_CURL + '：下载音效需要 curl（macOS 自带；Linux 用包管理器安装）');
  return r;
}

/** 只发 HEAD 请求，列出名字 / 场合 / 标题 / 来源 / 大小，给用户确认后再下载。 */
export function listSfx(lib, { head = (url) => curl(['-I', url]).stdout || '' } = {}) {
  return Object.entries(lib.sounds).map(([name, s]) => {
    const url = sfxUrl(lib, name);
    // -L 跟随跳转时会打出每一跳的响应头，文件大小在最后一个
    const lengths = [...head(url).matchAll(/content-length:\s*(\d+)/gi)];
    return { name, role: s.role, title: s.title, url, bytes: lengths.length ? +lengths.at(-1)[1] : null };
  });
}

const isStale = (dest, deps) => !fs.existsSync(dest) || deps.some((d) => fs.statSync(d).mtimeMs > fs.statSync(dest).mtimeMs);

/**
 * 下载缺的原始文件，并（重新）处理过期的。某条失败不影响其余。
 * @returns {Promise<{name: string, ok: boolean, error?: string, bytes?: number, seconds?: number}[]>}
 */
export async function fetchSfx(lib, { log = console.log, download = (url, dest) => curl(['-o', dest, url]).status === 0 } = {}) {
  const results = [];
  for (const [name, s] of Object.entries(lib.sounds)) {
    const raw = rawFile(lib, name);
    const url = sfxUrl(lib, name);
    try {
      fs.mkdirSync(path.dirname(raw), { recursive: true });
      if (!fs.existsSync(raw) || !fs.statSync(raw).size) {
        const part = raw + '.part';
        if (!download(url, part) || !fs.existsSync(part)) throw new Error(`下载失败：${url}`);
        fs.renameSync(part, raw);
      }
      const dest = preparedFile(lib, name);
      if (isStale(dest, [raw, lib.file])) await prepareSfx(raw, dest, s.maxSeconds);
      const bytes = fs.statSync(raw).size;
      const seconds = fs.statSync(dest).size / 2 / SR; // 16-bit 单声道
      log(`  ✓ ${name.padEnd(8)} ${String(s.id).padStart(5)}  ${s.title.padEnd(36)} ${String(Math.round(bytes / 1024)).padStart(5)} KB → ${seconds.toFixed(2)}s`);
      results.push({ name, ok: true, bytes, seconds });
    } catch (e) {
      if (e.message.startsWith(NO_CURL)) throw e; // 每条都会一样失败，直接停
      log(`  ✗ ${name.padEnd(8)} ${e.message}`);
      results.push({ name, ok: false, error: e.message });
    }
  }
  return results;
}

function decode(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`读不了音效文件：${file}\n${String(r.stderr).slice(-400)}`);
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}

/**
 * 同一镜里超过一个"叮"、两个音效起点落在同一帧，返回警告文字（不中断）。
 * @param {{name: string, at: number}[]} placements
 * @param {{id: string, start: number, duration: number}[]} shots
 */
export function densityWarnings(placements, shots = []) {
  const warnings = [];
  for (const shot of shots) {
    const n = placements.filter((p) => p.name === DING && p.at >= shot.start && p.at < shot.start + shot.duration).length;
    if (n > 1) warnings.push(`${shot.id} 里有 ${n} 个 ${DING}（每镜最多一个"叮"）`);
  }
  const sorted = [...placements].sort((a, b) => a.at - b.at);
  for (let i = 1; i < sorted.length; i++) {
    const [a, b] = [sorted[i - 1], sorted[i]];
    if (b.at - a.at < 1 / FPS) warnings.push(`${a.name} 和 ${b.name} 在 ${a.at.toFixed(2)}s 同一帧响起（同一拍不叠两个音效）`);
  }
  return warnings;
}

/**
 * 给 audio/build.mjs 用的音效对象。
 * @returns {{names: string[], placements: {name: string, at: number}[], place: (buf: object, name: string, o: {at: number, volume?: number}) => void}}
 */
export function createSfx(lib) {
  const decoded = new Map();
  const placements = [];
  const names = Object.keys(lib.sounds);
  const samples = (name) => {
    if (!lib.sounds[name]) throw new Error(`风格 ${lib.styleId} 没有音效「${name}」。可用：${names.join('、')}`);
    const file = preparedFile(lib, name);
    if (!fs.existsSync(file)) throw new Error(`音效「${name}」还没下载：先运行 wka sfx <片目录> --list 给用户确认，再 wka sfx <片目录>`);
    if (!decoded.has(name)) decoded.set(name, decode(file));
    return decoded.get(name);
  };
  const place = (buf, name, { at, volume = 1 }) => {
    if (!Number.isFinite(at)) throw new Error(`sfx.place('${name}') 的 at 要是秒数，收到 ${at}（同步点名写错了？）`);
    const data = samples(name);
    if (at < 0) return;
    const gain = lib.sounds[name].level * volume;
    const s = Math.round(at * buf.sr);
    const n = Math.min(data.length, buf.L.length - s);
    for (let i = 0; i < n; i++) {
      buf.L[s + i] += data[i] * gain;
      buf.R[s + i] += data[i] * gain;
    }
    placements.push({ name, at });
  };
  return { names, placements, place };
}
