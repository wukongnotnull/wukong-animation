// README 画廊区：每个已可用的风格都有画廊图，且由 build-catalog 放进 <!-- gallery --> 区块。
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

test('每个已可用的风格都有画廊图 docs/gallery/<id>.jpg', () => {
  for (const s of available) assert.ok(fs.existsSync(path.join(ROOT, gallery(s))), `${gallery(s)} 不存在`);
});

test('README 画廊区为每张画廊图放一张图，配风格名', () => {
  for (const s of available) {
    assert.match(block, new RegExp(`<img src="${gallery(s)}"[^>]*alt="${s.name}"`), s.id);
  }
});
