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
const { subsetChars, fontUrls, ensureFontFile, subsetFont, prepareFonts } = await import('../../plugin/engine/core/fonts.mjs');
const { FONT_CACHE_DIR } = await import('../../plugin/engine/core/paths.mjs');

/** 一个能通过文件头与大小检查的假 TrueType 文件 */
function fakeFont(file) {
  const buf = Buffer.alloc(20_000);
  buf.writeUInt32BE(0x00010000, 0);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}
const reset = () => fs.rmSync(FONT_CACHE_DIR, { recursive: true, force: true });

test('子集字体按内容复用，字表变化不改变镜头使用的源字体指纹', {skip:process.platform==='win32'}, () => {
  reset();
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-subset-reuse-'));
  const oldPath=process.env.PATH;
  try {
    const font=path.join(FONT_CACHE_DIR,'Inter.ttf');fakeFont(font);
    fs.writeFileSync(path.join(dir,'python3'),`#!/bin/sh\nfor arg in "$@"; do\n case "$arg" in --output-file=*) out="\${arg#--output-file=}";; esac\ndone\ncp "$3" "$out"\nprintf x >> '${dir}/calls'\n`,{mode:0o755});
    process.env.PATH=dir+path.delimiter+oldPath;
    const first=subsetFont(font,'春',dir);
    assert.equal(subsetFont(font,'春',dir),first);
    assert.equal(fs.readFileSync(path.join(dir,'calls'),'utf8'),'x','相同字表不重跑fontTools');
    const a=prepareFonts([{family:'Inter'}],{text:'春',workDir:dir});
    const b=prepareFonts([{family:'Inter'}],{text:'春江',workDir:dir});
    assert.ok(a.cacheCss?.includes('Inter.ttf'),'缓存身份使用完整源字体');
    assert.equal(a.cacheCss,b.cacheCss);
    fs.appendFileSync(font,'changed');subsetFont(font,'春',dir);
    assert.ok(fs.readFileSync(path.join(dir,'calls'),'utf8').length>1,'源字体变化必须重建');
  } finally {process.env.PATH=oldPath;fs.rmSync(dir,{recursive:true,force:true});}
});

test('另一镜新增汉字不让未改镜头失效，修改源字体仍使两镜失效', async () => {
  reset();
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-font-hashes-'));
  const styleDir=path.join(HOME,'styles/font-test');fs.mkdirSync(styleDir,{recursive:true});
  fs.writeFileSync(path.join(styleDir,'style.json'),JSON.stringify({id:'font-test',name:'字体测试',category:'xinxi',order:999,engine:'>=0.1.0',pipeline:'browser',kits:{},fps:30,fonts:[{family:'Inter'}],keywords:['test']}));
  fakeFont(path.join(FONT_CACHE_DIR,'Inter.ttf'));
  fs.mkdirSync(path.join(dir,'shots'));
  fs.writeFileSync(path.join(dir,'shots/s01.js'),"wk.shot({render(){/*春*/}})");
  fs.writeFileSync(path.join(dir,'shots/s02.js'),"wk.shot({render(){/*江*/}})");
  fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify({title:'fonts',style:'font-test',size:[320,180],fps:30,seed:1,shots:[{id:'s01',file:'shots/s01.js',duration:1},{id:'s02',file:'shots/s02.js',duration:1}]}));
  try {
    const {shotHashes}=await import('../../plugin/engine/core/job.mjs');
    const before=shotHashes(dir);
    fs.appendFileSync(path.join(dir,'shots/s02.js'),'//花月夜');
    const after=shotHashes(dir);
    assert.equal(after.s01,before.s01);assert.notEqual(after.s02,before.s02);
    fs.appendFileSync(path.join(FONT_CACHE_DIR,'Inter.ttf'),'changed');
    const fontChange=shotHashes(dir);
    assert.notEqual(fontChange.s01,after.s01);assert.notEqual(fontChange.s02,after.s02);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

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
