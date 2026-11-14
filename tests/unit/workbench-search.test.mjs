import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTextMatches, nextMatchIndex } from '../../plugin/engine/workbench/search.mjs';

test('search finds Chinese and case-insensitive literal matches with exact UTF-16 offsets', () => {
  assert.deepEqual(findTextMatches('悟空与悟空', '悟空'), [{ start: 0, end: 2 }, { start: 3, end: 5 }]);
  assert.deepEqual(findTextMatches('AbC abc', 'ABC'), [{ start: 0, end: 3 }, { start: 4, end: 7 }]);
  assert.deepEqual(findTextMatches('İ 😀ABC', 'abc'), [{ start: 4, end: 7 }]);
  assert.deepEqual(findTextMatches('a.*[x] a.*[x]', '.*[x]'), [{ start: 1, end: 6 }, { start: 8, end: 13 }]);
});

test('search handles empty terms, missing matches, whitespace and non-overlapping matches', () => {
  assert.deepEqual(findTextMatches('悟空', ''), []);
  assert.deepEqual(findTextMatches('悟空', '   '), []);
  assert.deepEqual(findTextMatches('悟空', '不存在'), []);
  assert.deepEqual(findTextMatches('aaaa', 'aa'), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  assert.deepEqual(findTextMatches('a b\nc', 'b\nc'), [{ start: 2, end: 5 }]);
});

test('match navigation wraps in both directions and handles zero results', () => {
  assert.equal(nextMatchIndex(0, 3, 1), 1);
  assert.equal(nextMatchIndex(2, 3, 1), 0);
  assert.equal(nextMatchIndex(0, 3, -1), 2);
  assert.equal(nextMatchIndex(0, 1, -1), 0);
  assert.equal(nextMatchIndex(-1, 0, 1), -1);
});
