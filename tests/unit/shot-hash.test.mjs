import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashParts } from '../../plugin/engine/core/cache.mjs';

/** 模拟两个插件版本目录：同样的相对布局，装在不同的绝对路径下。 */
function install(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-hash-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return (rel) => ({ file: path.join(root, rel) });
}

const LAYOUT = { 'runtime/a.js': 'A', 'runtime/b.js': 'B', 'shots/s01.mjs': 'shot' };
const parts = (at) => ['opts', at('runtime/a.js'), at('runtime/b.js'), at('shots/s01.mjs')];

test('内容相同、安装位置不同的文件，哈希相同', () => {
  const v030 = install(LAYOUT);
  const v031 = install(LAYOUT);
  assert.equal(hashParts(parts(v030)), hashParts(parts(v031)));
});

test('文件内容改变，哈希随之改变', () => {
  const before = install(LAYOUT);
  const after = install({ ...LAYOUT, 'shots/s01.mjs': 'shot v2' });
  assert.notEqual(hashParts(parts(before)), hashParts(parts(after)));
});

test('两个文件互换内容，哈希改变', () => {
  const before = install(LAYOUT);
  const swapped = install({ ...LAYOUT, 'runtime/a.js': 'B', 'runtime/b.js': 'A' });
  assert.notEqual(hashParts(parts(before)), hashParts(parts(swapped)));
});

test('内容在相邻文件之间挪动，哈希改变', () => {
  const before = install({ ...LAYOUT, 'runtime/a.js': 'AB', 'runtime/b.js': '' });
  const after = install({ ...LAYOUT, 'runtime/a.js': 'A', 'runtime/b.js': 'B' });
  assert.notEqual(hashParts(parts(before)), hashParts(parts(after)));
});

test('文件缺失与存在，哈希不同', () => {
  const at = install(LAYOUT);
  const missing = { file: path.join(path.dirname(at('runtime/a.js').file), 'gone.js') };
  assert.notEqual(hashParts(['opts', missing]), hashParts(['opts', at('runtime/a.js')]));
});
