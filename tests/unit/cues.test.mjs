import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { usedCueNames, pickCues } from '../../plugin/engine/core/cues.mjs';

test('collects literal cue names from cueIn / cueOut calls', () => {
  const src = `wk.seg(t, s.cueIn('第一句'), s.cueOut("第一句")); const k = s.cueIn(\`落印\`);`;
  assert.deepEqual([...usedCueNames([src])].sort(), ['第一句', '落印'].sort());
});

test('returns an empty set when a shot uses no cues', () => {
  assert.deepEqual([...usedCueNames(['wk.shot({ render() {} })'])], []);
});

test('returns null when a cue name is dynamic', () => {
  assert.equal(usedCueNames(['const n = "a"; s.cueIn(n)']), null);
});

test('returns null when the cues object is read directly', () => {
  assert.equal(usedCueNames(['const c = wk.config.cues;']), null);
});

test('pickCues keeps only cues the shot uses, with sorted keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-cues-'));
  const shot = path.join(dir, 's01.js');
  fs.writeFileSync(shot, "s.cueOut('b'); s.cueIn('a'); s.cueIn('missing')");
  const picked = pickCues({ a: [1, 2], b: [3, 4], c: [5, 6] }, [shot]);
  assert.deepEqual(Object.keys(picked), ['a', 'b', 'missing']);
  assert.deepEqual(picked, { a: [1, 2], b: [3, 4], missing: null });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pickCues falls back to every cue when usage cannot be determined', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-cues-'));
  const shot = path.join(dir, 's01.js');
  fs.writeFileSync(shot, 'for (const n of names) s.cueIn(n)');
  assert.deepEqual(pickCues({ b: [3, 4], a: [1, 2] }, [shot]), { a: [1, 2], b: [3, 4] });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cueChars with a literal name is recognised as that cue’s per-character points', () => {
  assert.deepEqual([...usedCueNames(["const c = s.cueChars('第四句');"])], ['第四句#*']);
  assert.equal(usedCueNames(['s.cueChars(name)']), null);
});

test('pickCues expands cueChars to every 名#n cue (sorted keys, like other cues)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-cues-'));
  const shot = path.join(dir, 's01.js');
  fs.writeFileSync(shot, "s.cueChars('四')");
  const cues = { 四: [1, 3], '四#1': [1, 1.5], '四#2': [1.5, 2], '四#10': [2.5, 3], '三#1': [0, 1] };
  assert.deepEqual(Object.keys(pickCues(cues, [shot])), ['四#1', '四#10', '四#2']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cueFrame literal participates in cue dependencies', () => {
  assert.deepEqual([...usedCueNames(["s.cueFrame('word:materials')"])], ['word:materials']);
});
