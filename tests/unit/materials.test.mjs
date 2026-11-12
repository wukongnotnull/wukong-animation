import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { inventoryMaterials, LARGE_FILE_BYTES } from '../../plugin/engine/core/materials.mjs';

const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const opts = { skip: ffmpeg ? false : '需要 ffmpeg' };

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-materials-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initializeProduction(dir);
  fs.writeFileSync(path.join(dir, 'film.json'), '{}');
  for (const rel of ['media/录屏', 'audio/voice', '资料']) fs.mkdirSync(path.join(dir, rel), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'shots/s01.tsx'), 'export default 1');
  fs.mkdirSync(path.join(dir, '杂项'), { recursive: true });
  fs.writeFileSync(path.join(dir, '杂项/别处.md'), '不在三个素材目录里');
  const make = (args, out) => assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', ...args, out]).status, 0);
  make(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=3'], path.join(dir, 'media/录屏/演示 01.mp4'));
  make(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2'], path.join(dir, 'audio/voice/口播.wav'));
  make(['-f', 'lavfi', '-i', 'color=c=red:size=64x48:duration=1', '-frames:v', '1'], path.join(dir, 'media/参考图.png'));
  fs.writeFileSync(path.join(dir, '资料/原稿.md'), '口播原稿');
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
  assert.equal(path.relative(dir, result.file), path.join('review', '素材', '素材清单.md'));
  assert.ok(result.items.every(item => /^(media|audio\/voice|资料)\//.test(item.rel)));
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

test('--add 按类型导入、跳过内容相同的文件、重名加序号并记录来源', opts, t => {
  const dir = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-materials-src-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, '新稿.txt'), '新的资料');
  fs.writeFileSync(path.join(outside, '原稿.md'), '同名但内容不同');
  fs.copyFileSync(path.join(dir, 'media/参考图.png'), path.join(outside, '换了名字的参考图.png'));
  fs.writeFileSync(path.join(outside, '无关.bin'), 'x');
  const logs = [];
  const result = inventoryMaterials(dir, { frames: 0, add: [outside], log: message => logs.push(message) });
  assert.deepEqual(result.added.map(item => item.rel).sort(), ['资料/原稿-2.md', '资料/新稿.txt']);
  assert.equal(result.skipped.length, 2);
  assert.ok(result.skipped.some(item => /内容相同/.test(item.reason)));
  assert.equal(fs.readFileSync(path.join(dir, '资料/原稿.md'), 'utf8'), '口播原稿');
  const origin = JSON.parse(fs.readFileSync(path.join(dir, '.wka/materials-origin.json'), 'utf8'));
  assert.equal(origin.files['资料/新稿.txt'].source, path.join(outside, '新稿.txt'));
  assert.match(origin.files['资料/新稿.txt'].sha256, /^[a-f0-9]{64}$/);
  assert.match(fs.readFileSync(result.file, 'utf8'), new RegExp(outside.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const again = inventoryMaterials(dir, { frames: 0, add: [outside] });
  assert.deepEqual(again.added, []);
});

test('单个素材超过 20 MB 且没有 Git LFS 规则时提醒，有规则时不提醒', opts, t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, '资料/大文件.pdf'), Buffer.alloc(LARGE_FILE_BYTES + 1));
  const warned = inventoryMaterials(dir, { frames: 0 });
  assert.ok(warned.warnings.some(text => text.includes('资料/大文件.pdf')));
  assert.match(fs.readFileSync(warned.file, 'utf8'), /体积提醒/);
  fs.writeFileSync(path.join(dir, '.gitattributes'), '*.pdf filter=lfs diff=lfs merge=lfs -text\n');
  assert.deepEqual(inventoryMaterials(dir, { frames: 0 }).warnings, []);
});
