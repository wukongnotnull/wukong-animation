import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { estimateFilm, recordRenderSpeed, formatEstimate } from '../../plugin/engine/core/estimate.mjs';

function fixture(t, durations, fps = 30) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-estimate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initializeProduction(dir);
  const shots = durations.map((duration, index) => ({ id: `s${String(index + 1).padStart(2, '0')}`, file: `shots/s${index + 1}.js`, duration }));
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify({ title: '估算', style: 'ink-wash', size: [1080, 1920], fps, seed: 1, shots }));
  return dir;
}

test('统计镜数、总长、最长单镜、小样与成片的帧数和尺寸', t => {
  const dir = fixture(t, [2, 6.5, 3]);
  const result = estimateFilm(dir);
  assert.equal(result.shots, 3);
  assert.equal(result.seconds, 11.5);
  assert.deepEqual(result.longest, { id: 's02', duration: 6.5 });
  assert.deepEqual([result.full.W, result.full.H, result.full.fps, result.full.frames], [1080, 1920, 30, 345]);
  assert.deepEqual([result.proxy.W, result.proxy.H, result.proxy.fps, result.proxy.frames], [540, 960, 15, 173]);
  assert.deepEqual(result.eta, { proxy: null, full: null });
});

test('超过单镜上限的镜头被列出', t => {
  const dir = fixture(t, [2, 6.5, 3]);
  assert.deepEqual(estimateFilm(dir, { maxShot: 3 }).over, [{ id: 's02', duration: 6.5 }]);
  assert.deepEqual(estimateFilm(dir, { maxShot: 8 }).over, []);
});

test('有渲染实测时按像素帧数外推用时；管线不同则不沿用', t => {
  const dir = fixture(t, [2, 6.5, 3]);
  recordRenderSpeed(dir, { proxy: true, pipeline: 'browser', width: 540, height: 960, frames: 100, ms: 10000 });
  const result = estimateFilm(dir, { pipeline: 'browser' });
  const perMegapixelFrame = 10000 / (100 * 540 * 960 / 1e6);
  assert.equal(Math.round(result.eta.proxy), Math.round(173 * 540 * 960 / 1e6 * perMegapixelFrame));
  assert.equal(result.eta.full, null);
  assert.equal(estimateFilm(dir, { pipeline: 'remotion' }).eta.proxy, null);
  assert.match(formatEstimate(result), /小样.*约 \d+ (秒|分钟)/);
});

test('没有实测时提示先渲一镜', t => {
  const dir = fixture(t, [2]);
  assert.match(formatEstimate(estimateFilm(dir)), /尚无渲染实测/);
});
