import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openImagePipe } from '../../plugin/engine/core/ffmpeg.mjs';
import { ShotCache } from '../../plugin/engine/core/cache.mjs';

test('abort() kills the encoder and resolves', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wka-pipe-')), 'x.mp4');
  const enc = openImagePipe(['-f', 'image2pipe', '-c:v', 'mjpeg', '-i', '-', '-f', 'mp4', out]);
  await enc.abort();
  await enc.abort(); // 重复调用也安全
});

test('write() rejects instead of hanging when ffmpeg exits early', async () => {
  // 喂给它非法数据，ffmpeg 会很快报错退出
  const enc = openImagePipe(['-f', 'image2pipe', '-c:v', 'mjpeg', '-i', '-', '-f', 'null', '-']);
  const junk = Buffer.alloc(1 << 20, 7);
  await assert.rejects(async () => {
    for (let i = 0; i < 200; i++) await enc.write(junk);
    await enc.end();
  });
});

test('ShotCache removes leftover .part segments on open', () => {
  const film = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-cache-'));
  const seg = path.join(film, '.cache', 'segments');
  fs.mkdirSync(seg, { recursive: true });
  fs.writeFileSync(path.join(seg, 's01-abc.mp4.part'), 'x');
  fs.writeFileSync(path.join(seg, 's02-def.mp4'), 'x');
  new ShotCache(film);
  assert.deepEqual(fs.readdirSync(seg), ['s02-def.mp4']);
  fs.rmSync(film, { recursive: true, force: true });
});
