import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSilences, soundRanges } from '../../plugin/engine/exporters/jianying/silence.mjs';

const STDERR = `
[silencedetect @ 0x1] silence_start: 0
[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 2.5
size=N/A time=00:00:10.00 bitrate=N/A speed= 500x
[silencedetect @ 0x1] silence_start: 4.25
[silencedetect @ 0x1] silence_end: 7 | silence_duration: 2.75
[silencedetect @ 0x1] silence_start: 9
`;

test('parses silence intervals, closing a trailing one at the file end', () => {
  assert.deepEqual(parseSilences(STDERR, 10), [
    { start: 0, end: 2.5 },
    { start: 4.25, end: 7 },
    { start: 9, end: 10 },
  ]);
});

test('parses no silences as an empty list', () => {
  assert.deepEqual(parseSilences('size=N/A time=00:00:10.00', 10), []);
});

test('keeps the sound between silences, padded on both sides', () => {
  const ranges = soundRanges([{ start: 0, end: 2.5 }, { start: 4.25, end: 7 }, { start: 9, end: 10 }], 10, { pad: 0.1 });
  assert.deepEqual(ranges, [
    { start: 2.4, end: 4.35 },
    { start: 6.9, end: 9.1 },
  ]);
});

test('returns the whole file when there is no silence', () => {
  assert.deepEqual(soundRanges([], 10, { pad: 0.1 }), [{ start: 0, end: 10 }]);
});

test('returns nothing for a file that is silent throughout', () => {
  assert.deepEqual(soundRanges([{ start: 0, end: 10 }], 10, { pad: 0.1 }), []);
});

test('clamps padding to the file bounds', () => {
  assert.deepEqual(soundRanges([{ start: 3, end: 10 }], 10, { pad: 0.1 }), [{ start: 0, end: 3.1 }]);
});

test('merges ranges whose padding makes them touch', () => {
  const ranges = soundRanges([{ start: 2, end: 2.15 }], 4, { pad: 0.1 });
  assert.deepEqual(ranges, [{ start: 0, end: 4 }]);
});
