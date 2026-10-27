import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../../plugin/engine/core/validate.mjs';
import { KNOWN_FONTS } from '../../plugin/engine/core/fonts.mjs';
import { usedCueNames } from '../../plugin/engine/core/cues.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugin/skills/keynote');
const style = JSON.parse(fs.readFileSync(path.join(DIR, 'style.json'), 'utf8'));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const scriptFiles = walk(path.join(DIR, 'scripts')).map((f) => path.relative(DIR, f).split(path.sep).join('/')).sort();

test('style.json 通过 schema 校验，是第 70 变、走 remotion 管线', () => {
  assert.deepEqual(validate('style', style, 'style.json'), []);
  assert.equal(style.id, 'keynote');
  assert.equal(style.order, 70);
  assert.equal(style.pipeline, 'remotion');
  assert.deepEqual(style.kits, {});
});

test('scripts 列出 scripts/ 下全部文件（全部进镜头哈希），入口是 index.ts', () => {
  assert.deepEqual([...style.scripts].sort(), scriptFiles);
  assert.ok(style.scripts.includes('scripts/index.ts'));
});

test('风格脚本不读整个 cues 对象：改一句人声只重渲用到它的镜头', () => {
  const names = usedCueNames(scriptFiles.map((f) => fs.readFileSync(path.join(DIR, f), 'utf8')));
  assert.notEqual(names, null);
  assert.equal(names.size, 0);
});

test('字体都能按需下载，背景图在 assets/', () => {
  for (const f of style.fonts) assert.ok(KNOWN_FONTS[f.family], `${f.family} 不在 KNOWN_FONTS`);
  assert.ok(fs.existsSync(path.join(DIR, 'assets', 'grid.jpg')));
});
