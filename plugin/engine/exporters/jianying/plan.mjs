// 把引擎的时间线换算成剪映草稿计划：时间用微秒整数，音量用线性倍数。纯函数，不碰文件。
import path from 'node:path';

const US = 1e6;
const VOICE_TRACK = '人声';

const us = (sec) => Math.round(sec * US);
const linearVolume = (db = 0) => (db ? 10 ** (db / 20) : 1);

/** 同名轨道在剪映里会冲突：第二个起加序号。 */
function uniqueName(name, taken) {
  let out = name;
  for (let i = 2; taken.has(out); i++) out = `${name} (${i})`;
  taken.add(out);
  return out;
}

/**
 * 一条音轨在草稿里的片段：有 ranges（有声音的区间，秒，相对文件开头）就每个区间一段，
 * 都引用同一个文件；没有就整段。段长裁到片尾，起点在片尾之后的段丢弃。
 */
function audioSegments(t, end) {
  const offset = t.start || 0;
  const ranges = t.ranges || [{ start: 0, end: Infinity }];
  return ranges
    .map((r) => {
      const start = us(offset + r.start);
      const length = r.end === Infinity ? Infinity : us(r.end - r.start);
      return { file: t.file, start, sourceStart: us(r.start), maxDuration: Math.min(length, end - start), volume: linearVolume(t.gain) };
    })
    .filter((s) => s.start < end);
}

function audioTracks(tracks, duration) {
  const end = us(duration);
  const placed = tracks.map((t) => ({ ...t, segments: audioSegments(t, end) })).filter((t) => t.segments.length);
  const voices = placed.filter((t) => t.role === 'voice');
  const taken = new Set();
  const out = [];
  if (voices.length) out.push({ name: uniqueName(VOICE_TRACK, taken), segments: voices.flatMap((t) => t.segments) });
  for (const t of placed.filter((x) => x.role !== 'voice')) {
    out.push({ name: uniqueName(path.basename(t.file), taken), segments: t.segments });
  }
  return out;
}

/**
 * @param {object} timeline { title, size:[W,H], fps, duration, shots, tracks, voices }
 * @returns {object} { name, width, height, fps, video, audioTracks, subtitles }
 */
export function buildDraftPlan(timeline) {
  const [width, height] = timeline.size;
  return {
    name: timeline.title,
    width,
    height,
    fps: timeline.fps,
    video: timeline.shots.map((s) => ({ name: s.id, file: s.file, start: us(s.start), duration: us(s.duration) })),
    audioTracks: audioTracks(timeline.tracks || [], timeline.duration),
    subtitles: (timeline.voices || []).map((v) => ({ text: v.text, start: us(v.at), duration: us(v.duration), estimated: !!v.estimated })),
  };
}
