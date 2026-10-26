import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDraftPlan } from '../../plugin/engine/exporters/jianying/plan.mjs';

const timeline = (over = {}) => ({
  title: '测试片',
  size: [1920, 1080],
  fps: 30,
  duration: 5,
  shots: [
    { id: 's01', start: 0, duration: 2, file: '/c/s01.mp4' },
    { id: 's02', start: 2, duration: 3, file: '/c/s02.mp4' },
  ],
  tracks: [],
  voices: [],
  ...over,
});

test('maps canvas, fps and draft name from the timeline', () => {
  const p = buildDraftPlan(timeline());
  assert.deepEqual([p.name, p.width, p.height, p.fps], ['测试片', 1920, 1080, 30]);
});

test('lays shots end to end in microseconds, named by shot id', () => {
  assert.deepEqual(buildDraftPlan(timeline()).video, [
    { name: 's01', file: '/c/s01.mp4', start: 0, duration: 2_000_000 },
    { name: 's02', file: '/c/s02.mp4', start: 2_000_000, duration: 3_000_000 },
  ]);
});

test('puts every voice file on a single 人声 track', () => {
  const p = buildDraftPlan(timeline({
    tracks: [
      { role: 'voice', file: '/a/vo1.wav', start: 0.5, gain: 2 },
      { role: 'voice', file: '/a/vo2.wav', start: 3, gain: 2 },
    ],
  }));
  assert.equal(p.audioTracks.length, 1);
  assert.equal(p.audioTracks[0].name, '人声');
  assert.deepEqual(p.audioTracks[0].segments.map((s) => [s.file, s.start]), [['/a/vo1.wav', 500_000], ['/a/vo2.wav', 3_000_000]]);
});

test('gives each build and user track its own track named after the file', () => {
  const p = buildDraftPlan(timeline({
    tracks: [
      { role: 'build', file: '/g/score.wav', start: 0, gain: 0 },
      { role: 'track', file: '/f/bgm.mp3', start: 1, gain: -6 },
    ],
  }));
  assert.deepEqual(p.audioTracks.map((t) => t.name), ['score.wav', 'bgm.mp3']);
});

test('disambiguates tracks whose files share a name', () => {
  const p = buildDraftPlan(timeline({
    tracks: [
      { role: 'build', file: '/g/a/score.wav', start: 0, gain: 0 },
      { role: 'track', file: '/g/b/score.wav', start: 0, gain: 0 },
    ],
  }));
  assert.deepEqual(p.audioTracks.map((t) => t.name), ['score.wav', 'score.wav (2)']);
});

test('converts dB gain to linear volume, defaulting to unity', () => {
  const p = buildDraftPlan(timeline({
    tracks: [
      { role: 'track', file: '/f/a.wav', start: 0, gain: -6 },
      { role: 'track', file: '/f/b.wav', start: 0 },
    ],
  }));
  const [a, b] = p.audioTracks.map((t) => t.segments[0].volume);
  assert.ok(Math.abs(a - 0.501187) < 1e-5, `got ${a}`);
  assert.equal(b, 1);
});

test('caps audio at the end of the film and drops segments starting after it', () => {
  const p = buildDraftPlan(timeline({
    tracks: [
      { role: 'track', file: '/f/a.wav', start: 1.5, gain: 0 },
      { role: 'track', file: '/f/late.wav', start: 5, gain: 0 },
    ],
  }));
  assert.deepEqual(p.audioTracks.map((t) => t.name), ['a.wav']);
  assert.equal(p.audioTracks[0].segments[0].maxDuration, 3_500_000);
});

test('has no audio tracks when there is no audio', () => {
  assert.deepEqual(buildDraftPlan(timeline()).audioTracks, []);
});

test('makes one subtitle per voice with its timing and estimate flag', () => {
  const p = buildDraftPlan(timeline({
    voices: [
      { text: '第一句', at: 0.5, duration: 1.2, estimated: false },
      { text: '第二句', at: 3, duration: 1, estimated: true },
    ],
  }));
  assert.deepEqual(p.subtitles, [
    { text: '第一句', start: 500_000, duration: 1_200_000, estimated: false },
    { text: '第二句', start: 3_000_000, duration: 1_000_000, estimated: true },
  ]);
});
