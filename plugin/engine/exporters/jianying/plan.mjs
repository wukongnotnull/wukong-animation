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

function audioSegment(t, end) {
  const start = us(t.start || 0);
  return { file: t.file, start, maxDuration: end - start, volume: linearVolume(t.gain) };
}

function audioTracks(tracks, duration) {
  const end = us(duration);
  const inFilm = tracks.filter((t) => us(t.start || 0) < end);
  const voices = inFilm.filter((t) => t.role === 'voice');
  const taken = new Set();
  const out = [];
  if (voices.length) out.push({ name: uniqueName(VOICE_TRACK, taken), segments: voices.map((t) => audioSegment(t, end)) });
  for (const t of inFilm.filter((x) => x.role !== 'voice')) {
    out.push({ name: uniqueName(path.basename(t.file), taken), segments: [audioSegment(t, end)] });
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
