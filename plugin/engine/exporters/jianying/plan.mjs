// 把引擎的时间线换算成剪映草稿计划：时间用微秒整数，音量用线性倍数。纯函数，不碰文件。
import path from 'node:path';

const US = 1e6;
const VOICE_TRACK = '人声';
const SUBTITLE_TRACK = '字幕';

// 剪映用不了任意字体文件：常见书法字体换成剪映字库里免费、最接近的（pyJianYingDraft FontType 的名字）；没有对应的不设字体
const JIANYING_FONTS = { 'Ma Shan Zheng': '古风小楷' };
// 以下两个换算在剪映 11.6 里对着烧录字幕校过：字号 5.2 ≈ 画高 5%；描边 40 ≈ 字号 12% 的烧录描边
const SIZE_PER_HEIGHT = 5.2 / 0.05;
const BORDER_PER_STROKE = 40 / 0.12;

const us = (sec) => Math.round(sec * US);
const linearVolume = (db = 0) => (db ? 10 ** (db / 20) : 1);

/** 同名轨道在剪映里会冲突：第二个起加序号。 */
function uniqueName(name, taken) {
  let out = name;
  for (let i = 2; taken.has(out); i++) out = `${name} (${i})`;
  taken.add(out);
  return out;
}

/** 按起点顺序放进第一条不重叠的道，都重叠就新开一条；返回每道的片段。 */
function lanes(items, lengthOf) {
  const out = [];
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    let lane = out.find((l) => l.end <= it.start);
    if (!lane) out.push((lane = { end: 0, items: [] }));
    lane.items.push(it);
    lane.end = it.start + lengthOf(it);
  }
  return out.map((l) => l.items);
}

const laneName = (base, i) => (i ? `${base} ${i + 1}` : base);

/**
 * 一条音轨在草稿里的片段：有 ranges（有声音的区间，秒，相对文件开头）就每个区间一段，
 * 都引用同一个文件；没有就整段。段长裁到片尾，起点在片尾之后的段丢弃。
 */
function audioSegments(t, end) {
  const offset = t.start || 0;
  // 人声带实际时长：按时长放，不延伸到片尾
  const ranges = t.ranges || [{ start: 0, end: t.duration ?? Infinity }];
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
  // 重叠的人声同一条轨放不下：分到「人声 2」…
  lanes(voices.flatMap((t) => t.segments), (s) => s.maxDuration).forEach((segments, i) => out.push({ name: uniqueName(laneName(VOICE_TRACK, i), taken), segments }));
  for (const t of placed.filter((x) => x.role !== 'voice')) {
    out.push({ name: uniqueName(path.basename(t.file), taken), segments: t.segments });
  }
  return out;
}

/**
 * 有字幕文件（timeline.subtitles，wka subtitles 生成的 srt）就按它；没有就与人声一一对应。
 * 重叠的分到「字幕 2」…，规则同人声。
 */
function subtitleTracks(voices, srt) {
  const subs = srt
    ? srt.map((s) => ({ text: s.text, start: us(s.start), duration: us(s.end - s.start), estimated: false }))
    : voices.map((v) => ({ text: v.text, start: us(v.at), duration: us(v.duration), estimated: !!v.estimated }));
  return lanes(subs, (s) => s.duration).map((segments, i) => ({ name: laneName(SUBTITLE_TRACK, i), segments }));
}

const round = (x, digits = 4) => +x.toFixed(digits);

/** CSS 颜色（#RGB / #RRGGBB / #RRGGBBAA / rgb() / rgba()）→ { color: [r,g,b]（0–1）, alpha }。 */
function parseColor(css) {
  const s = String(css).trim();
  let rgba;
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    rgba = [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255));
    rgba[3] /= 255;
  } else {
    const fn = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (!fn) throw new Error(`读不懂字幕颜色「${css}」：style.json 的 subtitles 请用 #RRGGBB 或 rgba(r,g,b,a)`);
    rgba = [+fn[1], +fn[2], +fn[3], fn[4] === undefined ? 1 : +fn[4]];
  }
  return { color: rgba.slice(0, 3).map((c) => round(c / 255)), alpha: round(rgba[3], 3) };
}

/**
 * 字幕样式（subtitle-layer.mjs subtitleStyle() 补齐缺省值后的 style.json subtitles 块）→ 剪映文字参数。
 * size、bottom 是画高的比例；transformY 是字幕中心的纵向位移，单位半个画高，向下为负。
 */
function jianyingSubtitleStyle(s) {
  if (!s) return null;
  const stroke = parseColor(s.stroke.color);
  return {
    font: JIANYING_FONTS[s.font.family] || null,
    size: round(s.size * SIZE_PER_HEIGHT, 2),
    ...parseColor(s.color),
    border: { ...stroke, width: round(Math.min(100, s.stroke.width * BORDER_PER_STROKE), 2) },
    transformY: round(-(1 - s.bottom - s.size / 2 - 0.5) * 2),
  };
}

/**
 * @param {object} timeline { title, size:[W,H], fps, duration, shots, tracks, voices, subtitles?, subtitleStyle? }
 * @returns {object} { name, width, height, fps, video, audioTracks, subtitleTracks, subtitleStyle }
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
    subtitleTracks: subtitleTracks(timeline.voices || [], timeline.subtitles),
    subtitleStyle: jianyingSubtitleStyle(timeline.subtitleStyle),
  };
}
