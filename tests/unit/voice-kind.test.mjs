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
  const { lines } = planVoiceLines({ voice_source: 'user', voices: [{ text: '雾散时', at: 0, file:'a.wav' }] });
  assert.equal(lines[0].kind, 'vo');
  assert.equal(lines[0].via, 'recording');
});

test('all voice kinds use user recordings', () => {
  const { lines } = planVoiceLines({
    voice_source: 'user',
    voices: [
      { text: '旁白', at: 0, file:'vo.wav' },
      { text: '采访原声', at: 3, kind: 'live', file: 'audio/voice/int.wav' },
    ],
  });
  assert.deepEqual(lines.map((l) => l.via), ['recording', 'recording']);
});

test('live lines without a recording are rejected', () => {
  assert.throws(
    () => planVoiceLines({ voice_source: 'user', voices: [{ text: '采访原声', at: 3, kind: 'live' }] }),
    /用户.*录音/,
  );
});

test('voice_source none drops every line', () => {
  const plan = planVoiceLines({ voice_source: 'none', voices: [{ text: 'x', at: 0, kind: 'live', file: 'a.wav' }] });
  assert.equal(plan.source, 'none');
  assert.deepEqual(plan.lines, []);
});

test('schema rejects automatic voice rate and pitch changes', () => {
  assert.equal(validate('film', film([{ text: '春眠', at: 0, rate: '-30%', pitch: '-4Hz' }])).length, 2);
  assert.equal(validate('film', film([{ text: '春眠', at: 0, rate: 'slow' }])).length, 1);
  assert.equal(validate('film', film([{ text: '春眠', at: 0, pitch: '-4' }])).length, 1);
});
