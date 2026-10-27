// 音效听感审计（移植自 wk-motion-graphics 的 sfx_audit.py）：每个音效起点比较"只有音效"和"其余（人声、音乐…）"
// 两条分轨的电平，音效比其余低 3 dB 以上记为被盖住。分轨不做响度标准化：母带第二遍是线性增益，不改相对电平。
import { spawnSync } from 'node:child_process';

const FPS = 30;
const WINDOW = 6; // 从起点量 6 帧（0.2 秒）
const MARGIN = -3;
const FLOOR = -120;
const SILENT_DB = -90; // 低于这个算音效轨没声音

/** 逐帧（1/fps 秒）单声道 RMS 电平，dBFS。 */
export function frameDb(file, fps = FPS) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`听感审计：读不了 ${file}（${r.error?.message || String(r.stderr).slice(-400)}）`);
  const s = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length));
  const spf = 48000 / fps;
  const out = [];
  for (let start = 0; start + spf <= s.length; start += spf) {
    let ms = 0;
    for (let i = start; i < start + spf; i++) ms += s[i] * s[i];
    ms /= spf;
    out.push(ms > 0 ? 10 * Math.log10(ms) : FLOOR);
  }
  return out;
}

const meanDb = (values) => {
  const p = values.reduce((a, v) => a + 10 ** (v / 10), 0) / values.length;
  return p > 0 ? 10 * Math.log10(p) : FLOOR;
};

/**
 * @param {{name: string, at: number}[]} placements 相对音效缓冲的时间（秒）；offset 是音效轨在全片里的起点
 * @param {number[]} sfxDb 音效分轨逐帧电平
 * @param {number[]} bedDb 其余分轨逐帧电平
 * @returns {{name: string, at: number, frame: number, diff: number|null, buried: boolean, missing?: boolean}[]} at 为全片时间
 */
export function judgeSfx(placements, sfxDb, bedDb, { quiet = new Set(), fps = FPS, offset = 0 } = {}) {
  const diffs = new Map(); // 同一帧起的音效共用一次测量
  return placements.flatMap((p) => {
    const at = p.at + offset; // 放置时间相对音效缓冲，加上音效轨的 start 才是全片时间
    const frame = Math.round(at * fps);
    const end = Math.min(frame + WINDOW, sfxDb.length, bedDb.length);
    if (frame < 0 || frame >= end) return [];
    const peak = Math.max(...sfxDb.slice(frame, end));
    // 音效轨在这里没声音：这个音效放进了别的文件，量不了，不算被盖住
    if (peak <= SILENT_DB) return [{ name: p.name, at, frame, diff: null, buried: false, missing: true }];
    if (!diffs.has(frame)) diffs.set(frame, peak - meanDb(bedDb.slice(frame, end)));
    const diff = diffs.get(frame);
    return [{ name: p.name, at, frame, diff, buried: diff < MARGIN && !quiet.has(p.name) }];
  });
}

const stamp = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

/** 审计结果 → 日志行：按音效汇总，再列被盖住的。 */
export function formatAudit(rows, shots = [], quiet = new Set()) {
  const shotAt = (t) => shots.find((s) => t >= s.start && t < s.start + s.duration)?.id || '-';
  const missing = rows.filter((r) => r.missing);
  const measured = rows.filter((r) => !r.missing);
  const byName = new Map();
  for (const r of measured) byName.set(r.name, [...(byName.get(r.name) || []), r]);
  const buriedCount = (rs) => rs.filter((r) => r.buried).length;
  const lines = ['  音效听感审计（音效比人声 + 音乐低 3 dB 以上算被盖住）：'];
  for (const [name, rs] of [...byName].sort(([a, x], [b, y]) => buriedCount(y) - buriedCount(x) || (a < b ? -1 : 1))) {
    const worst = Math.min(...rs.map((r) => r.diff));
    const note = quiet.has(name) ? '  故意做轻，不报' : buriedCount(rs) ? '  ! 调高电平、挪到句间空档或换起音更脆的录音' : '';
    lines.push(`    ${name.padEnd(8)} ${String(rs.length).padStart(3)} 次  被盖住 ${String(buriedCount(rs)).padStart(2)}  最差 ${worst >= 0 ? '+' : ''}${worst.toFixed(1)} dB${note}`);
  }
  const buried = measured.filter((r) => r.buried);
  for (const r of buried) lines.push(`    ! ${stamp(r.at)}  ${shotAt(r.at).padEnd(5)} ${r.name.padEnd(8)} ${r.diff.toFixed(1)} dB`);
  if (missing.length) lines.push(`    · ${missing.length} 个不在 sfx.wav 里，没审：${[...new Set(missing.map((r) => r.name))].join('、')}`);
  lines.push(`    共 ${measured.length} 个音效，${buried.length} 个被盖住`);
  return lines;
}
