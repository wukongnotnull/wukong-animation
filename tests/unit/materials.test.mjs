import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { inventoryMaterials } from '../../plugin/engine/core/materials.mjs';

const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const opts = { skip: ffmpeg ? false : '需要 ffmpeg' };

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-materials-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initializeProduction(dir);
  fs.writeFileSync(path.join(dir, 'film.json'), '{}');
  fs.mkdirSync(path.join(dir, '素材/录屏'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'shots/s01.tsx'), 'export default 1');
  const make = (args, out) => assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', ...args, out]).status, 0);
  make(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=3'], path.join(dir, '素材/录屏/演示 01.mp4'));
  make(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2'], path.join(dir, '素材/口播.wav'));
  make(['-f', 'lavfi', '-i', 'color=c=red:size=64x48:duration=1', '-frames:v', '1'], path.join(dir, '素材/参考图.png'));
  fs.writeFileSync(path.join(dir, '素材/原稿.md'), '口播原稿');
  return dir;
}

test('清点视频、音频、图片和文档；只给视频抽帧；不扫描镜头和生成目录', opts, t => {
  const dir = fixture(t);
  const result = inventoryMaterials(dir, { frames: 3 });
  const byName = Object.fromEntries(result.items.map(item => [path.basename(item.file), item]));
  assert.deepEqual(Object.keys(byName).sort(), ['原稿.md', '参考图.png', '口播.wav', '演示 01.mp4']);
  assert.equal(byName['演示 01.mp4'].kind, 'video');
  assert.deepEqual([byName['演示 01.mp4'].width, byName['演示 01.mp4'].height], [320, 180]);
  assert.ok(Math.abs(byName['演示 01.mp4'].duration - 3) < 0.2);
  assert.equal(byName['演示 01.mp4'].frames.length, 3);
  for (const frame of byName['演示 01.mp4'].frames) assert.ok(fs.statSync(frame).size > 0);
  assert.equal(byName['口播.wav'].kind, 'audio');
  assert.deepEqual([byName['参考图.png'].kind, byName['参考图.png'].width], ['image', 64]);
  assert.equal(byName['原稿.md'].kind, 'document');
  const report = fs.readFileSync(result.file, 'utf8');
  assert.match(report, /素材清单/);
  assert.match(report, /演示 01\.mp4/);
  assert.match(report, /素材抽帧\//);
});

test('没有素材时写明为空，不报错', opts, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-materials-empty-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initializeProduction(dir);
  fs.writeFileSync(path.join(dir, 'film.json'), '{}');
  const result = inventoryMaterials(dir);
  assert.deepEqual(result.items, []);
  assert.match(fs.readFileSync(result.file, 'utf8'), /没有找到素材/);
});
