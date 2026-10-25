import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// FONT_CACHE_DIR 在模块加载时由 WUKONG_ANIMATION_HOME 决定，所以先设环境变量再动态导入
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-fonts-'));
process.env.WUKONG_ANIMATION_HOME = HOME;
delete process.env.WKA_NO_FONT_DOWNLOAD;
const { subsetChars, fontUrls, ensureFontFile } = await import('../../plugin/engine/core/fonts.mjs');
const { FONT_CACHE_DIR } = await import('../../plugin/engine/core/paths.mjs');

/** 一个能通过文件头与大小检查的假 TrueType 文件 */
function fakeFont(file) {
  const buf = Buffer.alloc(20_000);
  buf.writeUInt32BE(0x00010000, 0);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}
const reset = () => fs.rmSync(FONT_CACHE_DIR, { recursive: true, force: true });

test('subset charset keeps the CJK text and adds all printable ASCII', () => {
  const chars = subsetChars('孤舟');
  for (const c of ['孤', '舟', 'A', 'z', '0', ' ', '!', ',', '.', '?', '~', '"', "'"]) assert.ok(chars.includes(c), `missing ${JSON.stringify(c)}`);
});

test('subset charset adds common CJK punctuation and has no duplicates', () => {
  const chars = subsetChars('孤孤，');
  for (const c of ['，', '。', '、', '「', '」', '《', '》', '·']) assert.ok(chars.includes(c), `missing ${c}`);
  assert.equal(new Set(chars).size, [...chars].length);
});

test('font URLs try GitHub first, then the jsDelivr mirror', () => {
  const urls = fontUrls('Ma Shan Zheng', {});
  assert.equal(urls.length, 2);
  assert.match(urls[0], /^https:\/\/github\.com\/google\/fonts\/raw\/main\/ofl\/mashanzheng\/MaShanZheng-Regular\.ttf$/);
  assert.match(urls[1], /^https:\/\/cdn\.jsdelivr\.net\/gh\/google\/fonts@main\/ofl\/mashanzheng\/MaShanZheng-Regular\.ttf$/);
});

test('WKA_FONT_MIRROR is tried before the built-in sources', () => {
  const urls = fontUrls('Ma Shan Zheng', { WKA_FONT_MIRROR: 'https://mirror.example.com/fonts/' });
  assert.equal(urls[0], 'https://mirror.example.com/fonts/ofl/mashanzheng/MaShanZheng-Regular.ttf');
  assert.equal(urls.length, 3);
});

test('unknown families have no URLs', () => {
  assert.deepEqual(fontUrls('No Such Font', {}), []);
});

test('falls through to the next source when the first one fails', () => {
  reset();
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-fontsrc-'));
  fakeFont(path.join(src, 'ok.ttf'));
  const urls = [pathToFileURL(path.join(src, 'missing.ttf')).href, pathToFileURL(path.join(src, 'ok.ttf')).href];
  const file = ensureFontFile('Ma Shan Zheng', { urls });
  assert.equal(file, path.join(FONT_CACHE_DIR, 'MaShanZheng.ttf'));
  assert.equal(fs.readdirSync(FONT_CACHE_DIR).filter((f) => f.endsWith('.part')).length, 0);
});

test('a failure marker blocks retries only for the same source list', () => {
  reset();
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-fontsrc-'));
  const bad = [pathToFileURL(path.join(src, 'missing.ttf')).href];
  assert.equal(ensureFontFile('Long Cang', { urls: bad }), null);
  assert.ok(fs.existsSync(path.join(FONT_CACHE_DIR, 'LongCang.ttf.failed')));

  // 同样的来源：24 小时内不重试，即使文件现在已经能下载了
  fakeFont(path.join(src, 'missing.ttf'));
  assert.equal(ensureFontFile('Long Cang', { urls: bad }), null);

  // 换了来源（比如配置了镜像）：立刻重试
  fakeFont(path.join(src, 'other.ttf'));
  const changed = [pathToFileURL(path.join(src, 'other.ttf')).href];
  assert.ok(ensureFontFile('Long Cang', { urls: changed }));
  assert.ok(!fs.existsSync(path.join(FONT_CACHE_DIR, 'LongCang.ttf.failed')));
});

test('a cached file with a bad header is re-downloaded', () => {
  reset();
  fs.mkdirSync(FONT_CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(FONT_CACHE_DIR, 'ZhiMangXing.ttf'), '<html>blocked</html>');
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-fontsrc-'));
  fakeFont(path.join(src, 'z.ttf'));
  const file = ensureFontFile('Zhi Mang Xing', { urls: [pathToFileURL(path.join(src, 'z.ttf')).href] });
  assert.equal(fs.readFileSync(file).readUInt32BE(0), 0x00010000);
});
