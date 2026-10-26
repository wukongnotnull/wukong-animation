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

test('puts non-overlapping voices on a single 人声 track, each as long as its audio', () => {
  const p = buildDraftPlan(timeline({
    tracks: [
      { role: 'voice', file: '/a/vo1.wav', start: 0.5, duration: 1.2, gain: 2 },
      { role: 'voice', file: '/a/vo2.wav', start: 3, duration: 1, gain: 2 },
    ],
  }));
  assert.equal(p.audioTracks.length, 1);
  assert.equal(p.audioTracks[0].name, '人声');
  assert.deepEqual(p.audioTracks[0].segments.map((s) => [s.file, s.start, s.maxDuration]), [['/a/vo1.wav', 500_000, 1_200_000], ['/a/vo2.wav', 3_000_000, 1_000_000]]);
});

test('moves an overlapping voice to a second 人声 track and reuses the first when free', () => {
  const p = buildDraftPlan(timeline({
    tracks: [
      { role: 'voice', file: '/a/vo1.wav', start: 0, duration: 2, gain: 2 },
      { role: 'voice', file: '/a/vo2.wav', start: 1.5, duration: 1, gain: 2 },
      { role: 'voice', file: '/a/vo3.wav', start: 2, duration: 1, gain: 2 },
    ],
  }));
  assert.deepEqual(p.audioTracks.map((t) => [t.name, t.segments.map((s) => s.file)]), [
    ['人声', ['/a/vo1.wav', '/a/vo3.wav']],
    ['人声 2', ['/a/vo2.wav']],
  ]);
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

test('splits a track into one segment per sound range, pointing into the same file', () => {
  const p = buildDraftPlan(timeline({
    tracks: [{ role: 'build', file: '/g/sfx.wav', start: 0, gain: 0, ranges: [{ start: 0.4, end: 1.1 }, { start: 3, end: 3.5 }] }],
  }));
  assert.deepEqual(p.audioTracks[0].segments.map(({ file, start, sourceStart, maxDuration }) => ({ file, start, sourceStart, maxDuration })), [
    { file: '/g/sfx.wav', start: 400_000, sourceStart: 400_000, maxDuration: 700_000 },
    { file: '/g/sfx.wav', start: 3_000_000, sourceStart: 3_000_000, maxDuration: 500_000 },
  ]);
});

test('offsets sound ranges by the track start and caps them at the film end', () => {
  const p = buildDraftPlan(timeline({
    tracks: [{ role: 'track', file: '/f/a.wav', start: 1, gain: 0, ranges: [{ start: 0, end: 1 }, { start: 3.5, end: 6 }, { start: 4.5, end: 5 }] }],
  }));
  assert.deepEqual(p.audioTracks[0].segments.map(({ start, sourceStart, maxDuration }) => [start, sourceStart, maxDuration]), [
    [1_000_000, 0, 1_000_000],
    [4_500_000, 3_500_000, 500_000],
  ]);
});

test('drops a track whose file has no sound at all', () => {
  const p = buildDraftPlan(timeline({ tracks: [{ role: 'build', file: '/g/empty.wav', start: 0, gain: 0, ranges: [] }] }));
  assert.deepEqual(p.audioTracks, []);
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
  assert.deepEqual(p.subtitleTracks, [{
    name: '字幕',
    segments: [
      { text: '第一句', start: 500_000, duration: 1_200_000, estimated: false },
      { text: '第二句', start: 3_000_000, duration: 1_000_000, estimated: true },
    ],
  }]);
});

test('moves an overlapping subtitle to a second 字幕 track', () => {
  const p = buildDraftPlan(timeline({
    voices: [
      { text: '甲', at: 0, duration: 2 },
      { text: '乙', at: 1, duration: 1 },
    ],
  }));
  assert.deepEqual(p.subtitleTracks.map((t) => [t.name, t.segments.map((s) => s.text)]), [['字幕', ['甲']], ['字幕 2', ['乙']]]);
});

test('takes subtitles from the srt when the timeline carries them, ignoring the voices', () => {
  const p = buildDraftPlan(timeline({
    voices: [{ text: '江水不回头，山也不回头', at: 0, duration: 3, estimated: true }],
    subtitles: [
      { index: 1, start: 0, end: 1.5, text: '江水不回头' },
      { index: 2, start: 1.5, end: 3, text: '山也不回头' },
    ],
  }));
  assert.deepEqual(p.subtitleTracks, [{
    name: '字幕',
    segments: [
      { text: '江水不回头', start: 0, duration: 1_500_000, estimated: false },
      { text: '山也不回头', start: 1_500_000, duration: 1_500_000, estimated: false },
    ],
  }]);
});

const inkSubs = {
  font: { family: 'Ma Shan Zheng', fallback: ['STKaiti'] },
  size: 0.05,
  color: '#2B2B2B',
  stroke: { color: 'rgba(242,237,227,0.9)', width: 0.12 },
  bottom: 0.1,
};

test('has no subtitle style when the timeline carries none', () => {
  assert.equal(buildDraftPlan(timeline()).subtitleStyle, null);
});

test('converts the style subtitle block into 剪映 size, colours, stroke and position', () => {
  const s = buildDraftPlan(timeline({ subtitleStyle: inkSubs })).subtitleStyle;
  assert.equal(s.font, '古风小楷');
  assert.equal(s.size, 5.2);
  assert.deepEqual(s.color.map((c) => Math.round(c * 255)), [0x2b, 0x2b, 0x2b]);
  assert.equal(s.alpha, 1);
  assert.deepEqual(s.border.color.map((c) => Math.round(c * 255)), [242, 237, 227]);
  assert.equal(s.border.alpha, 0.9);
  assert.equal(s.border.width, 40);
  assert.equal(s.transformY, -0.75);
});

test('leaves the font unset when 剪映 has no counterpart for it', () => {
  const s = buildDraftPlan(timeline({ subtitleStyle: { ...inkSubs, font: { family: 'Noto Sans SC' }, color: '#fff', stroke: { color: '#00000080', width: 0.08 } } })).subtitleStyle;
  assert.equal(s.font, null);
  assert.deepEqual(s.color, [1, 1, 1]);
  assert.deepEqual([s.border.color, s.border.alpha], [[0, 0, 0], 0.502]);
});

test('rejects a subtitle colour it cannot read', () => {
  assert.throws(() => buildDraftPlan(timeline({ subtitleStyle: { ...inkSubs, color: 'ink' } })), /字幕颜色/);
});
