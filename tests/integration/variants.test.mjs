// 横竖双版：同一部片按画幅出主版和副版。需要真实的 Chromium + ffmpeg（wka setup）；缺依赖时跳过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check } from '../../plugin/engine/pipelines/browser/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WKA = path.join(ROOT, 'plugin/engine/bin/wka.mjs');
const ready = (await check()).ok;
const opts = { skip: ready ? false : 'browser 管线依赖未安装（运行 wka setup）' };

const FILL = (color) => `ctx.fillStyle = '${color}'; ctx.fillRect(0, 0, s.W, s.H);`;
const SHOT = (body) => `wk.shot({ render(ctx, t, s) { ${body} } });\n`;
// s02 按画幅分支：横屏白、竖屏蓝
const BRANCHED = SHOT(`${FILL('#FFFFFF')} if (s.orientation === 'portrait') { ${FILL('#0000FF')} }`);

/** 主版 320×180、副版 9:16 的最小片子；s01 有竖版覆盖文件（红）。 */
function makeFilm(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-variants-'));
  fs.mkdirSync(path.join(dir, 'shots'));
  fs.writeFileSync(path.join(dir, 'shots', 's01.js'), SHOT(FILL('#F2EDE3')));
  fs.writeFileSync(path.join(dir, 'shots', 's01.9x16.js'), SHOT(FILL('#FF0000')));
  fs.writeFileSync(path.join(dir, 'shots', 's02.js'), BRANCHED);
  const film = {
    title: 'it', style: 'ink-wash', size: [320, 180], fps: 10, seed: 1,
    shots: [{ id: 's01', file: 'shots/s01.js', duration: 1 }, { id: 's02', file: 'shots/s02.js', duration: 1 }],
    variants: { '9:16': {} },
    export: { name: 'it' },
    ...extra,
  };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  return dir;
}

const wka = (...args) => spawnSync(process.execPath, [WKA, ...args], { encoding: 'utf8', env: { ...process.env, WKA_NO_FONT_DOWNLOAD: '1', WKA_WORKERS: '2' } });
const ok = (r) => assert.equal(r.status, 0, r.stdout + r.stderr);

function videoSize(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return r.stdout.trim().split(',').filter(Boolean).map(Number);
}

/** 图片或视频首帧中心像素的 [r, g, b] */
function centerRgb(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'crop=2:2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
  return [...r.stdout.subarray(0, 3)];
}
const near = (rgb, want) => rgb.length === 3 && rgb.every((v, i) => Math.abs(v - want[i]) < 24);

test('the main version keeps its paths; the variant renders into .cache/9x16 at its own size', opts, () => {
  const dir = makeFilm();
  ok(wka('render', dir));
  assert.deepEqual(videoSize(path.join(dir, '.cache', 'video.mp4')), [320, 180]);
  const manifest = fs.readFileSync(path.join(dir, '.cache', 'manifest.json'), 'utf8');

  ok(wka('render', dir, '--aspect', '9:16'));
  assert.deepEqual(videoSize(path.join(dir, '.cache', '9x16', 'video.mp4')), [180, 320]);
  assert.equal(fs.readdirSync(path.join(dir, '.cache', '9x16', 'segments')).length, 2);
  assert.equal(fs.readFileSync(path.join(dir, '.cache', 'manifest.json'), 'utf8'), manifest, '主版缓存不被副版改动');
});

test('the variant uses override shot files and s.orientation; the main version does not', opts, () => {
  const dir = makeFilm();
  ok(wka('still', dir, '--at', 's01:0.5,s02:0.5'));
  ok(wka('still', dir, '--aspect', '9:16', '--at', 's01:0.5,s02:0.5'));
  assert.ok(near(centerRgb(path.join(dir, 'stills', 's01-0.50s.png')), [242, 237, 227]));
  assert.ok(near(centerRgb(path.join(dir, 'stills', 's02-0.50s.png')), [255, 255, 255]));
  assert.ok(near(centerRgb(path.join(dir, 'stills', '9x16', 's01-0.50s.png')), [255, 0, 0]));
  assert.ok(near(centerRgb(path.join(dir, 'stills', '9x16', 's02-0.50s.png')), [0, 0, 255]));
});

test('variant review files carry the aspect suffix', opts, () => {
  const dir = makeFilm();
  ok(wka('render', dir, '--proxy', '--aspect', '9:16'));
  assert.ok(fs.existsSync(path.join(dir, 'review', '小样-9x16.mp4')));
  ok(wka('animatic', dir, '--aspect', '9:16'));
  assert.ok(fs.existsSync(path.join(dir, 'review', '动态分镜-9x16.mp4')));
  assert.ok(fs.existsSync(path.join(dir, 'review', '接触表-9x16.jpg')));
  assert.ok(!fs.existsSync(path.join(dir, 'review', '小样.mp4')), '主版审阅文件不被写');
});

test('an aspect the film does not declare fails with the usable ones', () => {
  const dir = makeFilm();
  const r = wka('render', dir, '--aspect', '4:3');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /16:9（主版）、9:16/);
  const bad = wka('render', makeFilm({ variants: undefined }), '--aspect', '9:16');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr + bad.stdout, /variants/);
});

test('wka subtitles --aspect writes the variant\'s own srt and English, split for its aspect', () => {
  const text = '每一帧都由代码画出来，镜头版式和声音全都写在工程里。';
  const dir = makeFilm({
    subtitles: { mode: 'burn', bilingual: true },
    audio: { voices: [{ text, at: 0 }] },
    cues: { vo1: [0, 2] },
  });
  ok(wka('subtitles', dir));
  const mainSrt = fs.readFileSync(path.join(dir, 'subtitles.srt'), 'utf8');
  const enFile = path.join(dir, 'subtitles.en.json');
  const pairs = JSON.parse(fs.readFileSync(enFile, 'utf8'));
  const english = ['Every frame is drawn by code', 'shots, layouts and sound all live in the project'];
  assert.equal(pairs.length, english.length);
  fs.writeFileSync(enFile, JSON.stringify(pairs.map((p, i) => ({ ...p, en: english[i] }))));

  ok(wka('subtitles', dir, '--aspect', '9:16'));
  const srt = fs.readFileSync(path.join(dir, 'subtitles.9x16.srt'), 'utf8');
  const count = (t) => t.trim().split(/\n\s*\n/).length;
  assert.ok(count(srt) > count(mainSrt), '竖屏每条字数更少，条数更多');
  const vPairs = JSON.parse(fs.readFileSync(path.join(dir, 'subtitles.en.9x16.json'), 'utf8'));
  assert.equal(vPairs.length, count(srt));
  assert.equal(vPairs.map((p) => p.en).join(' '), english.join(' '), '英文沿用主版，只重新拆条');
  assert.equal(fs.readFileSync(path.join(dir, 'subtitles.srt'), 'utf8'), mainSrt, '主版字幕不动');

  // 已存在时只检查不覆盖（可能手改过断句）
  const edited = srt.replace('每一帧', '每一帧 ');
  fs.writeFileSync(path.join(dir, 'subtitles.9x16.srt'), edited);
  ok(wka('subtitles', dir, '--aspect', '9:16'));
  assert.equal(fs.readFileSync(path.join(dir, 'subtitles.9x16.srt'), 'utf8'), edited);
});

test('wka qc --aspect checks the variant video and writes its report under .cache/9x16', opts, () => {
  const dir = makeFilm();
  ok(wka('render', dir, '--proxy', '--aspect', '9:16'));
  wka('qc', dir, '--proxy', '--aspect', '9:16');
  assert.ok(fs.existsSync(path.join(dir, '.cache', '9x16', 'qc.json')));
  assert.ok(!fs.existsSync(path.join(dir, '.cache', 'qc.json')), '主版质检报告不被写');
});

const report = (dir) => fs.readFileSync(path.join(dir, 'review', '主版不变报告-9x16.md'), 'utf8');
const rowOf = (text, id) => text.split('\n').find((l) => l.startsWith(`| ${id} `)) || '';
const state = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.wka', 'state.json'), 'utf8'));

test('signing off step 13 snapshots the main version; variant renders report whether it changed', opts, () => {
  const dir = makeFilm();
  ok(wka('render', dir));
  ok(wka('signoff', dir, '成片终审通过', '--step', '13'));
  assert.deepEqual(Object.keys(state(dir).approved.main), ['s01', 's02']);
  assert.deepEqual(fs.readdirSync(path.join(dir, '.cache', 'approved')).sort(), ['s01.mp4', 's02.mp4']);

  // 没改代码：哈希相同
  ok(wka('render', dir, '--aspect', '9:16', '--proxy'));
  assert.match(report(dir), /主版画面没有变化/);
  assert.match(rowOf(report(dir), 's01'), /哈希相同/);

  // 只改竖屏分支：主版哈希变了，但重渲后画面一致
  fs.writeFileSync(path.join(dir, 'shots', 's02.js'), BRANCHED.replace('#0000FF', '#00FF00'));
  ok(wka('render', dir, '--aspect', '9:16', '--proxy'));
  assert.match(rowOf(report(dir), 's02'), /重渲比对通过/);
  assert.match(report(dir), /主版画面没有变化/);

  // 改了横屏画面：报告置顶写明，命令仍然成功
  fs.writeFileSync(path.join(dir, 'shots', 's01.js'), SHOT(FILL('#000000')));
  ok(wka('render', dir, '--aspect', '9:16', '--proxy'));
  assert.match(report(dir).split('\n').slice(0, 3).join('\n'), /主版有变化/);
  assert.match(rowOf(report(dir), 's01'), /画面有变化/);

  // 快照丢了：改为目视复核
  fs.rmSync(path.join(dir, '.cache', 'approved'), { recursive: true });
  ok(wka('render', dir, '--aspect', '9:16', '--proxy'));
  assert.match(rowOf(report(dir), 's01'), /快照缺失/);
});

test('a variant signed off before the main version changed is stale: final refuses it, status says so', opts, () => {
  const dir = makeFilm();
  ok(wka('render', dir));
  ok(wka('signoff', dir, '终审通过', '--step', '13'));
  ok(wka('signoff', dir, '副版通过', '--step', '14'));
  assert.ok(state(dir).approved.variants['9:16'].shots.s01);

  fs.writeFileSync(path.join(dir, 'shots', 's01.js'), SHOT(FILL('#000000')));
  ok(wka('render', dir));
  ok(wka('signoff', dir, '返修后终审通过', '--step', '13'));
  const r = wka('final', dir, '--aspect', '9:16', '--proxy');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /第 14 道/);

  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-variants-project-'));
  fs.mkdirSync(path.join(projectDir, 'films'));
  fs.cpSync(dir, path.join(projectDir, 'films', 'it'), { recursive: true });
  const status = wka('status', projectDir);
  ok(status);
  assert.match(status.stdout, /9:16 副版已过期/);
});

test('wka final --aspect names the variant output with its suffix; --aspect all makes every version', opts, () => {
  const dir = makeFilm();
  ok(wka('final', dir, '--aspect', '9:16', '--proxy'));
  assert.deepEqual(videoSize(path.join(dir, 'it-9x16-proxy.mp4')), [90, 160]);
  assert.ok(!fs.existsSync(path.join(dir, 'it-proxy.mp4')));
  ok(wka('final', dir, '--aspect', 'all', '--proxy'));
  assert.deepEqual(videoSize(path.join(dir, 'it-proxy.mp4')), [160, 90]);
  assert.deepEqual(videoSize(path.join(dir, 'it-9x16-proxy.mp4')), [90, 160]);
});
