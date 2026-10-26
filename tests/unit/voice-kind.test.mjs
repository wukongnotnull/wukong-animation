import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../../plugin/engine/core/validate.mjs';
import { planVoiceLines } from '../../plugin/engine/audio/soundtrack.mjs';

const film = (voiceover) => ({
  title: 't',
  style: 'ink-wash',
  size: [1920, 1080],
  fps: 30,
  seed: 7,
  shots: [{ id: 's01', file: 'shots/s01.js', duration: 4 }],
  audio: { voiceover },
});

test('schema accepts every voice kind with a speaker', () => {
  for (const kind of ['vo', 'dialogue', 'os', 'sync']) {
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
  const { lines } = planVoiceLines({ vo_source: 'ai', voiceover: [{ text: '雾散时', at: 0 }] });
  assert.equal(lines[0].kind, 'vo');
  assert.equal(lines[0].via, 'tts');
});

test('sync lines use their recording even when vo_source is ai', () => {
  const { lines } = planVoiceLines({
    vo_source: 'ai',
    voiceover: [
      { text: '旁白', at: 0 },
      { text: '采访原声', at: 3, kind: 'sync', file: 'audio/voice/int.wav' },
    ],
  });
  assert.deepEqual(lines.map((l) => l.via), ['tts', 'file']);
});

test('sync lines without a recording are rejected', () => {
  assert.throws(
    () => planVoiceLines({ vo_source: 'ai', voiceover: [{ text: '采访原声', at: 3, kind: 'sync' }] }),
    /同期声.*采访原声/s,
  );
});

test('vo_source none drops every line', () => {
  const plan = planVoiceLines({ vo_source: 'none', voiceover: [{ text: 'x', at: 0, kind: 'sync', file: 'a.wav' }] });
  assert.equal(plan.source, 'none');
  assert.deepEqual(plan.lines, []);
});
