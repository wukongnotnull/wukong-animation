import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../../plugin/engine/core/validate.mjs';
import { planVoiceLines } from '../../plugin/engine/audio/soundtrack.mjs';

const film = (voices) => ({
  title: 't',
  style: 'ink-wash',
  size: [1920, 1080],
  fps: 30,
  seed: 7,
  shots: [{ id: 's01', file: 'shots/s01.js', duration: 4 }],
  audio: { voices },
});

test('schema accepts every voice kind with a speaker', () => {
  for (const kind of ['vo', 'dialogue', 'os', 'live']) {
    const errs = validate('film', film([{ text: '来了？', at: 1, kind, speaker: '老者', file: 'a.wav' }]));
    assert.deepEqual(errs, [], kind);
  }
});

test('schema rejects an unknown voice kind', () => {
  const errs = validate('film', film([{ text: '来了？', at: 1, kind: 'narration' }]));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /kind/);
});

test('lines without kind default to vo', () => {
  const { lines } = planVoiceLines({ voice_source: 'ai', voices: [{ text: '雾散时', at: 0 }] });
  assert.equal(lines[0].kind, 'vo');
  assert.equal(lines[0].via, 'tts');
});

test('live lines use their recording even when voice_source is ai', () => {
  const { lines } = planVoiceLines({
    voice_source: 'ai',
    voices: [
      { text: '旁白', at: 0 },
      { text: '采访原声', at: 3, kind: 'live', file: 'audio/voice/int.wav' },
    ],
  });
  assert.deepEqual(lines.map((l) => l.via), ['tts', 'recording']);
});

test('live lines without a recording are rejected', () => {
  assert.throws(
    () => planVoiceLines({ voice_source: 'ai', voices: [{ text: '采访原声', at: 3, kind: 'live' }] }),
    /同期声.*采访原声/s,
  );
});

test('voice_source none drops every line', () => {
  const plan = planVoiceLines({ voice_source: 'none', voices: [{ text: 'x', at: 0, kind: 'live', file: 'a.wav' }] });
  assert.equal(plan.source, 'none');
  assert.deepEqual(plan.lines, []);
});
