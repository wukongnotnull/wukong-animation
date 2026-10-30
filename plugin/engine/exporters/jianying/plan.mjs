// 把引擎的时间线换算成剪映草稿计划：时间用微秒整数，音量用线性倍数。纯函数，不碰文件。
import path from 'node:path';
import { JIANYING_FONTS } from './fonts.mjs';

const US = 1e6;
const VOICE_TRACK = '人声';
const SUBTITLE_TRACK = '字幕';
const EN_SUBTITLE_TRACK = '英文字幕';
/** 字幕行高（字号的倍数），与烧录层一致 */
const LINE_HEIGHT = 1.3;

// 剪映11.6/pyJianYingDraft0.3.1 原生探针：字号按画宽换算。
// 1920宽每单位约11.3778px，1080宽约6.4px；横/竖/方形及两档字号证据见交付修复报告。
const NATIVE_SIZE_WIDTH = 168.75;
const BORDER_PER_STROKE = 40 / 0.12;

const us = (sec) => Math.round(sec * US);
const linearVolume = (db = 0) => (db ? 10 ** (db / 20) : 1);

/** 输入已由渲染器量化到帧；共享帧切点只转换一次，不独立舍入镜长。 */
function videoSegments(timeline) {
  const { fps } = timeline;
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) throw new Error('草稿时间轴帧率无效');
  let endFrame = 0;
  const video = timeline.shots.map(s => {
    const start = Math.round(s.start * fps), frames = Math.round(s.duration * fps);
    if (!Number.isFinite(s.start) || !Number.isFinite(s.duration) || frames <= 0 || start !== endFrame ||
        Math.abs(s.start * fps - start) > 1e-6 || Math.abs(s.duration * fps - frames) > 1e-6) {
      throw new Error(`草稿时间轴镜头 ${s.id}：重叠、缺口、逆序或无效帧区间`);
    }
    endFrame = start + frames;
    const startUs = us(start / fps), endUs = us(endFrame / fps);
    return { name: s.id, file: s.file, start: startUs, duration: endUs - startUs };
  });
  if (!Number.isFinite(timeline.duration) || Math.abs(timeline.duration * fps - endFrame) > 1e-6) throw new Error('草稿时间轴终点与全片时长不一致');
  return video;
}

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
function subtitleTracks(voices, srt, base = SUBTITLE_TRACK) {
  const subs = srt
    ? srt.map((s) => ({ text: s.text, start: us(s.start), duration: us(s.end - s.start), estimated: false, ...(s.draftStyle ? {style:s.draftStyle} : {}) }))
    : voices.map((v) => ({ text: v.text, start: us(v.at), duration: us(v.duration), estimated: !!v.estimated }));
  return lanes(subs, (s) => s.duration).map((segments, i) => ({ name: laneName(base, i), segments }));
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
function jianyingSubtitleStyle(s, { font = s?.font, lift = 0, canvas = [1920,1080], measurement, lang = 'zh' } = {}) {
  if (!s) return null;
  const stroke = parseColor(s.stroke.color);
  const [W,H] = canvas;
  const rect = measurement?.rects.find(r=>r.lang===lang);
  const px = measurement ? measurement[lang] : Math.round(s.size * H);
  return {
    // 对照表里没有或值为 null：不设字体，用剪映默认字体
    font: JIANYING_FONTS[font.family] || null,
    size: round(px * NATIVE_SIZE_WIDTH / W),
    ...parseColor(s.color),
    border: { ...stroke, width: round(Math.min(100, s.stroke.width * BORDER_PER_STROKE), 2) },
    // lift：往上挪几行（双语时中文在英文上面一行）
    transformY: rect ? round(1 - 2 * (rect.y + rect.h / 2) / H) : round(-(1 - s.bottom - s.size / 2 - 0.5) * 2 + lift * s.size * LINE_HEIGHT * 2),
    ...(rect ? {transformX:round(2 * (rect.x + rect.w / 2) / W - 1)} : {}),
  };
}

/** 双语：中文轨上移一行，另起「英文字幕」轨在原来的位置；每条轨带自己的样式。单语时原样返回。 */
function bilingualTracks(tracks, srt, style, canvas) {
  if (!srt?.some((s) => s.en)) return tracks;
  const en = subtitleTracks([], srt.map((s) => ({ ...s, text: s.en || '', draftStyle:s.draftEnglishStyle })), EN_SUBTITLE_TRACK);
  const zhStyle = jianyingSubtitleStyle(style, { lift: 1, canvas });
  const enStyle = jianyingSubtitleStyle(style, { font: style?.font_en || style?.font, canvas });
  return [...tracks.map((t) => ({ ...t, style: zhStyle })), ...en.map((t) => ({ ...t, style: enStyle }))];
}

/**
 * @param {object} timeline { title, size:[W,H], fps, duration, shots, tracks, voices, subtitles?, subtitleStyle? }
 * @returns {object} { name, width, height, fps, video, audioTracks, subtitleTracks, subtitleStyle }
 */
export function buildDraftPlan(timeline) {
  const [width, height] = timeline.size;
  let subs = timeline.subtitles;
  if (timeline.subtitleMeasurements !== undefined) {
    const ms = timeline.subtitleMeasurements;
    if (!subs || !timeline.subtitleStyle || ms.length !== subs.length) throw new Error('草稿字幕测量条数与当前字幕不一致');
    subs = subs.map((s,i)=>{
      const m = ms[i], langs = s.en ? ['zh','en'] : ['zh'];
      if (!m || m.index !== s.index || !m.loaded || langs.some(lang=>!Number.isFinite(m[lang]) || m[lang]<=0 || !m.rects?.some(r=>r.lang===lang && [r.x,r.y,r.w,r.h].every(Number.isFinite) && r.w>0 && r.h>0))) throw new Error(`第 ${s.index} 条草稿字幕测量缺失或无效`);
      return {...s,draftStyle:jianyingSubtitleStyle(timeline.subtitleStyle,{canvas:timeline.size,measurement:m}),
        ...(s.en?{draftEnglishStyle:jianyingSubtitleStyle(timeline.subtitleStyle,{canvas:timeline.size,measurement:m,lang:'en',font:timeline.subtitleStyle.font_en || timeline.subtitleStyle.font})}:{})};
    });
  }
  return {
    name: timeline.title,
    width,
    height,
    fps: timeline.fps,
    video: videoSegments(timeline),
    audioTracks: audioTracks(timeline.tracks || [], timeline.duration),
    subtitleTracks: bilingualTracks(subtitleTracks(timeline.voices || [], subs), subs, timeline.subtitleStyle, timeline.size),
    subtitleStyle: jianyingSubtitleStyle(timeline.subtitleStyle,{canvas:timeline.size}),
  };
}
