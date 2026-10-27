import { test } from 'node:test';
import assert from 'node:assert/strict';
import { charCues, clearCharCues } from '../../plugin/engine/audio/char-cues.mjs';

test('one sound range per clause: characters share their clause evenly, punctuation takes no time', () => {
  const cues = charCues('春眠，不觉晓。', '一', { at: 10, duration: 3, ranges: [{ start: 0.2, end: 1.0 }, { start: 1.5, end: 2.4 }] });
  assert.deepEqual(cues, {
    '一#1': [10.2, 10.6],
    '一#2': [10.6, 11],
    '一#3': [11.5, 11.8],
    '一#4': [11.8, 12.1],
    '一#5': [12.1, 12.4],
  });
});

test('when ranges and clauses do not line up, the whole line (first to last sound) is shared evenly', () => {
  const cues = charCues('春眠不觉晓', '一', { at: 0, duration: 3, ranges: [{ start: 0.5, end: 1 }, { start: 1.5, end: 3 }] });
  assert.deepEqual(Object.values(cues), [[0.5, 1], [1, 1.5], [1.5, 2], [2, 2.5], [2.5, 3]]);
});

test('without audio the estimated span is shared evenly', () => {
  const cues = charCues('花落', '四', { at: 2, duration: 1, ranges: null });
  assert.deepEqual(cues, { '四#1': [2, 2.5], '四#2': [2.5, 3] });
});

test('clearCharCues removes only that line’s per-character points', () => {
  const out = clearCharCues({ 一: [0, 1], '一#1': [0, 0.5], '一#2': [0.5, 1], 二: [2, 3], '二#1': [2, 3], '一二#1': [9, 9] }, '一');
  assert.deepEqual(out, { 一: [0, 1], 二: [2, 3], '二#1': [2, 3], '一二#1': [9, 9] });
});
