// Test-only user confirmation for synthetic audio fixtures; never used by runtime.
import { voiceAlignmentStatus, importVoiceTiming } from '../../plugin/engine/audio/voice-alignment.mjs';
export function confirmFixtureVoices(dir) {
  const { voices } = voiceAlignmentStatus(dir);
  if (!Object.keys(voices).length) return;
  importVoiceTiming(dir, { version: 1, voices: Object.fromEntries(Object.entries(voices).map(([id, { source }]) => [id, {
    source, segments: [{ text: source.text || '测试录音', start: 0, end: source.duration }]
  }])) }, { confirmation: '自动测试夹具的明确人工时间点；不是自动识别或真实用户签批' });
}
