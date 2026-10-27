import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkShotSizes, SHOT_SIZES } from '../../plugin/engine/core/shot-sizes.mjs';
import { validate } from '../../plugin/engine/core/validate.mjs';
import { readProgress } from '../../plugin/engine/core/state.mjs';

const shots = (...sizes) => sizes.map((size, i) => ({ id: `s0${i + 1}`, file: `shots/s0${i + 1}.js`, duration: 1, ...(size ? { size } : {}) }));

test('a storyboard that follows the rules passes', () => {
  assert.deepEqual(checkShotSizes(shots('近景', '远景', '中景', '特写', '远景')), []);
});

test('a shot without a size is reported', () => {
  assert.deepEqual(checkShotSizes(shots('近景', null, '特写')), ['镜头 s02 没有写景别（film.json 的 shots[].size）']);
});

test('four or more shots need at least three sizes', () => {
  assert.deepEqual(checkShotSizes(shots('近景', '特写', '近景', '特写')), ['4 个镜头只用了 2 种景别（近景、特写），至少要 3 种']);
});

test('adjacent shots with the same size are reported', () => {
  assert.deepEqual(checkShotSizes(shots('近景', '特写', '特写', '远景')), ['s02 和 s03 都是特写，相邻两镜景别要不同']);
});

test('three shots or fewer do not need three sizes', () => {
  assert.deepEqual(checkShotSizes(shots('近景', '特写', '近景')), []);
});

test('schema accepts the seven sizes and rejects others', () => {
  const film = (size) => ({ title: 't', style: 'ink-wash', size: [320, 180], fps: 10, seed: 1, shots: [{ id: 's01', file: 'a.js', duration: 1, size }] });
  assert.equal(SHOT_SIZES.length, 7);
  for (const s of SHOT_SIZES) assert.deepEqual(validate('film', film(s)), [], s);
  assert.equal(validate('film', film('大全景')).length, 1);
});

// ── wka signoff --step 5 ──
const WKA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugin/engine/bin/wka.mjs');
function filmWith(sizes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-size-'));
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify({ title: 't', style: 'ink-wash', size: [320, 180], fps: 10, seed: 1, shots: shots(...sizes) }));
  return dir;
}

test('signoff --step 5 refuses a storyboard that breaks the size rules and records nothing', () => {
  const dir = filmWith(['近景', '特写', '特写', '远景']);
  const r = spawnSync(process.execPath, [WKA, 'signoff', dir, '分镜签批', '--step', '5'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /s02 和 s03 都是特写/);
  assert.equal(readProgress(dir).step || 0, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('signoff --step 5 --force records the sign-off with the problems attached', () => {
  const dir = filmWith(['近景', '特写', '特写', '远景']);
  const r = spawnSync(process.execPath, [WKA, 'signoff', dir, '分镜签批', '--step', '5', '--force'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const st = readProgress(dir);
  assert.equal(st.step, 5);
  assert.match(st.history.at(-1).note, /^分镜签批（景别检查未通过：s02 和 s03 都是特写/);
  fs.rmSync(dir, { recursive: true, force: true });
});
