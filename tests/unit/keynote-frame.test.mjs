import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE = path.join(ROOT, 'plugin/engine');
const esbuild = createRequire(path.join(ENGINE, 'package.json'))('esbuild');

// frame.tsx 是 TSX：打包成一个 ESM 文件再 import，React 一起打进去
async function loadFrames() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wka-frame-')), 'frame.mjs');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'plugin/skills/keynote/scripts/frame.tsx')],
    bundle: true, platform: 'node', format: 'esm', outfile: out, nodePaths: [path.join(ENGINE, 'node_modules')], logLevel: 'silent',
  });
  return (await import(pathToFileURL(out).href)).FRAMES;
}
const FRAMES = await loadFrames();

const SUBTITLE_LINE = 1.3;
const SUBTITLE_PAD = 22;
/** 字幕带上沿：两行字幕加内边距，和 Guides.tsx 一致 */
const bandTop = (f) => f.subtitle.bottom - (f.subtitle.size * SUBTITLE_LINE * 2 + SUBTITLE_PAD);
const inside = (r, o) => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const [name, f] of Object.entries(FRAMES)) {
  test(`${name}：版式母版都在安全区里、在字幕带之上`, () => {
    for (const [id, slots] of Object.entries(f.layout)) {
      const rects = id === 'L07' ? slots.cards : Object.values(slots);
      for (const r of rects) {
        assert.ok(inside(r, f.safe), `${id} ${JSON.stringify(r)} 出了安全区`);
        assert.ok(r.y + r.h <= bandTop(f), `${id} ${JSON.stringify(r)} 进了字幕带`);
      }
    }
  });

  test(`${name}：L07 四张卡片互不重叠`, () => {
    const cards = f.layout.L07.cards;
    assert.equal(cards.length, 4);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(!overlap(cards[i], cards[j]), `卡片 ${i + 1} 和 ${j + 1} 重叠`);
  });

  test(`${name}：细节页铺满整个画面`, () => {
    assert.deepEqual(f.scene.detail, { x: 0, y: 0, w: f.W, h: f.H });
  });
}
