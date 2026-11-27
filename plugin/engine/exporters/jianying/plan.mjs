// 把引擎的时间线换算成剪映草稿计划：时间用微秒整数，音量用线性倍数。纯函数，不碰文件。
import path from 'node:path';

const US = 1e6;
const VOICE_TRACK = '人声';
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

function audioTracks(tracks, duration, reservedNames) {
  const end = us(duration);
  const placed = tracks.map((t) => ({ ...t, segments: audioSegments(t, end) })).filter((t) => t.segments.length);
  const voices = placed.filter((t) => t.role === 'voice');
  const taken = new Set(reservedNames);
  const out = [];
  // 重叠的人声同一条轨放不下：分到「人声 2」…
  lanes(voices.flatMap((t) => t.segments), (s) => s.maxDuration).forEach((segments, i) => out.push({ name: uniqueName(laneName(VOICE_TRACK, i), taken), segments }));
  for (const t of placed.filter((x) => x.role !== 'voice')) {
    out.push({ name: uniqueName(path.basename(t.file), taken), segments: t.segments });
  }
  return out;
}

function srtTimestamp(ms) {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  const clock = [hours, minutes, seconds].map(n => String(n).padStart(2, '0')).join(':');
  return `${clock},${String(ms % 1000).padStart(3, '0')}`;
}

function buildSubtitleSrt(captions, duration) {
  // SRT 只支持毫秒。片尾不足一毫秒时向下取整，避免字幕延长草稿。
  const limit = Math.floor(duration * 1000 + 1e-6);
  const events = captions.flatMap(({ text, start, end }) => {
    const from = Math.round(start * 1000), to = Math.min(limit, Math.round(end * 1000));
    // SRT 用空行划分片段，移除正文中的空行并保留有文字的换行。
    const cue = text.split(/\r\n?|\n/u).map(line => line.trim()).filter(Boolean).join('\n');
    if (to <= from || !cue) return [];
    const entry = { text: cue };
    return [{ at: from, entry, enters: true }, { at: to, entry, enters: false }];
  }).sort((a, b) => a.at - b.at);

  const blocks = [], active = new Set();
  let previous = 0;
  for (const { at, entry, enters } of events) {
    // 交叠句段在重叠时合为同一文本片段，保留各句的显示起止。
    if (at > previous && active.size) {
      blocks.push(`${blocks.length + 1}\n${srtTimestamp(previous)} --> ${srtTimestamp(at)}\n${[...active].map(cue => cue.text).join('\n')}\n`);
    }
    if (enters) active.add(entry);
    else active.delete(entry);
    previous = at;
  }
  return blocks.join('\n');
}

export function buildDraftPlan(timeline) {
  const [width, height] = timeline.size;
  if (timeline.subtitles || timeline.subtitleMeasurements || timeline.subtitleStyle) throw new Error('剪映草稿字幕使用已核对的台词定位，不接受旧版字幕配置');
  const video = videoSegments(timeline);
  const srt = buildSubtitleSrt(timeline.captions || [], timeline.duration);
  const subtitle = srt ? { name: '字幕', srt } : null;
  return {
    name: timeline.title,
    width,
    height,
    fps: timeline.fps,
    video,
    audioTracks: audioTracks(timeline.tracks || [], timeline.duration, subtitle ? [subtitle.name] : []),
    subtitle,
  };
}
