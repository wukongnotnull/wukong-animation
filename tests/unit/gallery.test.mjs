// README 画廊区：有图片的风格展示图片；没有示范片时保留风格列表。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin/catalog.json'), 'utf8'));
const available = catalog.styles.filter((s) => s.status === 'available');
const block = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').match(/<!-- gallery -->([\s\S]*?)<!-- \/gallery -->/)[1];

const gallery = (s) => `docs/gallery/${s.id}.jpg`;

test('README 画廊区列出每个已可用的风格', () => {
  for (const s of available) assert.ok(block.includes(`**${s.name}**`), s.id);
});

test('README 画廊区只展示存在的图片，并配风格名', () => {
  for (const s of available) {
    const image = `<img src="${gallery(s)}" width="400" alt="${s.name}">`;
    assert.equal(block.includes(image), fs.existsSync(path.join(ROOT, gallery(s))), s.id);
  }
  for (const [, src] of block.matchAll(/<img src="([^"]+)"/g)) {
    assert.ok(fs.existsSync(path.join(ROOT, src)), `${src} 不存在`);
  }
});
