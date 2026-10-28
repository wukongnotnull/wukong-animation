import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { recordApproval, readProgress, variantStale, staleVariants } from '../../plugin/engine/core/state.mjs';
import { psnrMin } from '../../plugin/engine/core/approval.mjs';

const filmDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-approval-'));
  fs.writeFileSync(path.join(dir, 'film.json'), '{}');
  return dir;
};

test('recordApproval stores the main version\'s shot hashes in state.json', () => {
  const dir = filmDir();
  recordApproval(dir, { main: { s01: 'a', s02: 'b' } });
  assert.deepEqual(readProgress(dir).approved.main, { s01: 'a', s02: 'b' });
});

test('a variant is not stale before it is signed off, nor right after', () => {
  const dir = filmDir();
  recordApproval(dir, { main: { s01: 'a' } });
  assert.equal(variantStale(readProgress(dir), '9:16'), false);
  recordApproval(dir, { variant: '9:16', shots: { s01: 'v' } });
  const st = readProgress(dir);
  assert.deepEqual(st.approved.variants['9:16'], { shots: { s01: 'v' }, main: { s01: 'a' } });
  assert.equal(variantStale(st, '9:16'), false);
  assert.deepEqual(staleVariants(st), []);
});

test('signing off the main version again makes every signed-off variant stale', () => {
  const dir = filmDir();
  recordApproval(dir, { main: { s01: 'a' } });
  recordApproval(dir, { variant: '9:16', shots: { s01: 'v' } });
  recordApproval(dir, { main: { s01: 'a2' } });
  const st = readProgress(dir);
  assert.equal(variantStale(st, '9:16'), true);
  assert.deepEqual(staleVariants(st), ['9:16']);
  // 主版哈希没变（重新签批但没改画面）不算过期
  recordApproval(dir, { variant: '9:16', shots: { s01: 'v' } });
  recordApproval(dir, { main: { s01: 'a2' } });
  assert.equal(variantStale(readProgress(dir), '9:16'), false);
});

test('recordApproval keeps the progress history', () => {
  const dir = filmDir();
  const st = readProgress(dir);
  recordApproval(dir, { main: { s01: 'a' } });
  assert.deepEqual(readProgress(dir).history, st.history);
});

/** 1 秒纯色短片 */
function clip(dir, name, color, seconds = 1) {
  const out = path.join(dir, name);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=64x36:r=10:d=${seconds}`, '-pix_fmt', 'yuv420p', '-y', out]);
  assert.equal(r.status, 0, String(r.stderr));
  return out;
}

test('psnrMin is Infinity for identical clips and low for different ones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-psnr-'));
  const a = clip(dir, 'a.mp4', 'white');
  const b = clip(dir, 'b.mp4', 'white');
  const c = clip(dir, 'c.mp4', 'red');
  assert.equal(await psnrMin(a, b), Infinity);
  assert.ok((await psnrMin(a, c)) < 50);
});

test('psnrMin fails clips of different length even when the shared frames match', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-psnr-'));
  const a = clip(dir, 'a.mp4', 'white');
  const longer = clip(dir, 'b.mp4', 'white', 2);
  assert.ok((await psnrMin(a, longer)) < 50);
});
