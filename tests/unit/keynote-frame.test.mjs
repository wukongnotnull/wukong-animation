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

const inside = (r, o) => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const [name, f] of Object.entries(FRAMES)) {
  test(`${name}：版式母版都在安全区里`, () => {
    for (const [id, slots] of Object.entries(f.layout)) {
      const rects = id === 'L07' ? slots.cards : Object.values(slots);
      for (const r of rects) {
        assert.ok(inside(r, f.safe), `${id} ${JSON.stringify(r)} 出了安全区`);
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

test('横屏 L02、L03 和 L06 的主图居中，并给标题和注释留出间距', () => {
  const { H, layout: { L02, L03, L06 } } = FRAMES.landscape;
  for (const [id, { title, image }, width] of [['L02', L02, 1440], ['L03', L03, 1680]]) {
    assert.deepEqual([image.w, image.h], [width, 584], `${id} 主图尺寸`);
    assert.equal(image.y + image.h / 2, H / 2, `${id} 主图中心`);
    assert.ok(image.y - (title.y + title.h) >= 16, `${id} 主图与标题间距`);
  }
  for (const [label, image] of [[L06.labelA, L06.imageA], [L06.labelB, L06.imageB]]) {
    assert.deepEqual([image.w, image.h], [808, 392], 'L06 主图尺寸');
    assert.equal(image.y + image.h / 2, H / 2, 'L06 主图中心');
    assert.ok(label.y - (L06.title.y + L06.title.h) >= 16, 'L06 标签与标题间距');
    assert.equal(image.y - (label.y + label.h), 16, 'L06 主图与标签间距');
    assert.equal(L06.note.y - (image.y + image.h), 12, 'L06 注释与主图间距');
  }
});

test('ShotRoot picks the frame spec from s.orientation given by the engine', () => {
  const src = fs.readFileSync(path.join(ROOT, 'plugin/skills/keynote/scripts/shot.tsx'), 'utf8');
  assert.match(src, /s\.orientation/);
  assert.doesNotMatch(src, /designH > s\.designW/);
});
