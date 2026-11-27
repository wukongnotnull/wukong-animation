export function hasSubtitleVoice(audio = {}) {
  return audio.voice_source !== 'none' && Boolean(audio.voices?.length);
}

function srtTimestamp(ms) {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  const clock = [hours, minutes, seconds].map(n => String(n).padStart(2, '0')).join(':');
  return `${clock},${String(ms % 1000).padStart(3, '0')}`;
}

export function buildSubtitleSrt(captions, duration) {
  // SRT 只支持毫秒。片尾不足一毫秒时向下取整，避免字幕超出影片时间线。
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
