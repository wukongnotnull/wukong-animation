// 需要真实的 Chromium + ffmpeg（wka setup）；缺依赖时整组跳过。
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

const SHOT = (body) => `wk.shot({ render(ctx, t, s) { ctx.fillStyle = '#F2EDE3'; ctx.fillRect(0, 0, s.W, s.H); ${body} } });\n`;

/** 在临时目录里搭一支最小的片子。shots: {id: 源码} */
function makeFilm(shots, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-it-'));
  fs.mkdirSync(path.join(dir, 'shots'));
  for (const [id, src] of Object.entries(shots)) fs.writeFileSync(path.join(dir, 'shots', `${id}.js`), src);
  const film = {
    title: 'it', style: 'ink-wash', size: [320, 180], fps: 10, seed: 1,
    shots: Object.keys(shots).map((id) => ({ id, file: `shots/${id}.js`, duration: 1 })),
    ...extra,
  };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  return dir;
}

const wka = (...args) => spawnSync(process.execPath, [WKA, ...args], { encoding: 'utf8', env: { ...process.env, WKA_NO_FONT_DOWNLOAD: '1', WKA_WORKERS: '2' } });
const wkaEnv = (env, ...args) => spawnSync(process.execPath, [WKA, ...args], { encoding: 'utf8', env: { ...process.env, WKA_NO_FONT_DOWNLOAD: '1', WKA_WORKERS: '2', ...env } });
const segments = (dir) => {
  const seg = path.join(dir, '.cache', 'segments');
  return fs.existsSync(seg) ? fs.readdirSync(seg) : [];
};
const setCues = (dir, cues) => {
  const f = path.join(dir, 'film.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), cues }));
};

test('a shot that fails mid-render leaves no partial segment and no running ffmpeg', opts, () => {
  const dir = makeFilm({
    s01: SHOT(''),
    s02: SHOT("if (s.frame >= 5) throw new Error('boom at frame ' + s.frame);"),
    s03: SHOT(''),
  });
  const r = wka('render', dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /boom at frame 5/);
  const segs = segments(dir);
  assert.equal(segs.filter((f) => f.endsWith('.part')).length, 0, `leftover: ${segs}`);
  assert.equal(segs.filter((f) => f.startsWith('s02-')).length, 0, 'failed shot must not leave a segment');
  const ps = spawnSync('pgrep', ['-f', `ffmpeg.*${dir}`], { encoding: 'utf8' });
  assert.equal(ps.stdout.trim(), '', 'no ffmpeg should still be running for this film');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('changing a cue only re-renders the shots that use it', opts, () => {
  const dir = makeFilm(
    {
      s01: SHOT("ctx.fillStyle = '#000'; ctx.fillRect(0, 0, s.W * wk.seg(t, s.cueIn('a'), s.cueOut('a')), 10);"),
      s02: SHOT(''),
    },
    { cues: { a: [0.2, 0.6], b: [1.2, 1.6] } }
  );
  assert.equal(wka('render', dir).status, 0);

  setCues(dir, { a: [0.2, 0.6], b: [1.3, 1.8] }); // 没有镜头用 b
  let out = wka('render', dir).stdout;
  assert.match(out, /s01 缓存命中/);
  assert.match(out, /s02 缓存命中/);

  setCues(dir, { a: [0.3, 0.7], b: [1.3, 1.8] }); // s01 用了 a
  out = wka('render', dir).stdout;
  assert.doesNotMatch(out, /s01 缓存命中/);
  assert.match(out, /s02 缓存命中/);
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 读图片（png / jpg）某个像素的 RGB。先转 rgb24：jpg 的色度是隔行采样的，直接裁 1×1 会失败。 */
function pixel(png, x, y) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', png, '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' });
  return [...r.stdout];
}

test('c2d.wash after translate is not clipped to the untransformed canvas', opts, () => {
  // 先把原点移到画面中心，再画一个盖满整幅画布的多边形：四个角都应该被墨色压暗
  const body = "ctx.save(); ctx.translate(s.W / 2, s.H / 2);"
    + " wk.c2d.wash(ctx, [[-s.W, -s.H], [s.W, -s.H], [s.W, s.H], [-s.W, s.H]], { color: '#000000', alpha: 0.8, blur: 0, edge: 0 });"
    + ' ctx.restore();';
  const dir = makeFilm({ s01: SHOT(body) });
  const r = wka('still', dir, '--at', 's01:0.5');
  assert.equal(r.status, 0, r.stderr);
  const png = path.join(dir, 'stills', fs.readdirSync(path.join(dir, 'stills')).find((f) => f.startsWith('s01-')));
  for (const [x, y] of [[2, 2], [317, 2], [2, 177], [317, 177]]) {
    const [red] = pixel(png, x, y);
    assert.ok(red < 120, `corner ${x},${y} should be inked, got ${red}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wka soundtrack works before the shots are drawn (only s01.js exists)', () => {
  const dir = makeFilm({ s01: SHOT('') });
  const f = path.join(dir, 'film.json');
  const film = JSON.parse(fs.readFileSync(f, 'utf8'));
  film.shots.push({ id: 's02', file: 'shots/s02.js', duration: 1 }, { id: 's03', file: 'shots/s03.js', duration: 1 });
  fs.mkdirSync(path.join(dir, 'audio'));
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=3', path.join(dir, 'audio', 'tone.wav')]);
  film.audio = { tracks: [{ file: 'audio/tone.wav' }] };
  fs.writeFileSync(f, JSON.stringify(film));
  const r = wka('soundtrack', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.cache', 'mix.wav')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('c2d.wash survives a scale(0) frame and a far zoom-out', opts, () => {
  const body = "ctx.save(); ctx.scale(0, 0); wk.c2d.wash(ctx, [[0, 0], [10, 0], [10, 10]], { blur: 2 }); ctx.restore();"
    + " ctx.save(); ctx.scale(0.02, 0.02); wk.c2d.wash(ctx, [[0, 0], [2000, 0], [2000, 2000], [0, 2000]], { color: '#000000', alpha: 0.8, blur: 0, edge: 0 }); ctx.restore();";
  const dir = makeFilm({ s01: SHOT(body) });
  const r = wka('still', dir, '--at', 's01:0.5');
  assert.equal(r.status, 0, r.stderr);
  const png = path.join(dir, 'stills', fs.readdirSync(path.join(dir, 'stills')).find((f) => f.startsWith('s01-')));
  assert.ok(pixel(png, 10, 10)[0] < 120, 'the zoomed-out square should still be inked');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wka animatic puts the animatic and its contact sheet in review/', opts, () => {
  const dir = makeFilm({ s01: SHOT(''), s02: SHOT('') });
  const r = wka('animatic', dir);
  assert.equal(r.status, 0, r.stderr);
  const video = path.join(dir, 'review', '动态分镜.mp4');
  const sheet = path.join(dir, 'review', '接触表.jpg');
  assert.ok(fs.existsSync(video) && fs.existsSync(sheet));
  assert.ok(r.stdout.includes(`动态分镜：${video}`));
  assert.ok(r.stdout.includes(`接触表：${sheet}`));
  assert.ok(!fs.existsSync(path.join(dir, 'animatic.mp4')));
  assert.ok(fs.existsSync(path.join(dir, 'stills', 'sheet.jpg')), 'stills/sheet.jpg is still written for the director');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('voices with chars: true get per-character cues that shots read with s.cueChars', opts, () => {
  // 第一个字一出现就把整幅画面涂黑：读不到逐字同步点时镜头会报错，读到了画面就是黑的
  const body = "const c = s.cueChars('一'); if (c.length !== 4) throw new Error('chars ' + c.length); if (t >= c[0].in) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, s.W, s.H); }";
  const dir = makeFilm({ s01: SHOT(body), s02: SHOT('') });
  const f = path.join(dir, 'film.json');
  const film = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.mkdirSync(path.join(dir, 'audio'));
  // 0.4s 有声 + 0.5s 静音 + 0.4s 有声，对应「春眠，不觉」两个分句
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=1.3', '-af', "volume='if(between(t,0.4,0.9),0,1)':eval=frame", path.join(dir, 'audio', 'vo.wav')]);
  film.audio = { voice_source: 'user', voices: [{ text: '春眠，不觉', at: 0.1, cue: '一', chars: true, file: 'audio/vo.wav' }] };
  fs.writeFileSync(f, JSON.stringify(film));
  const r = wka('soundtrack', dir);
  assert.equal(r.status, 0, r.stderr);
  const cues = JSON.parse(fs.readFileSync(f, 'utf8')).cues;
  assert.deepEqual(Object.keys(cues).filter((k) => k.startsWith('一#')), ['一#1', '一#2', '一#3', '一#4']);
  assert.ok(cues['一#3'][0] >= 0.9, `second clause starts after the pause: ${cues['一#3']}`);
  const st = wka('still', dir, '--at', 's01:0.8');
  assert.equal(st.status, 0, st.stderr);
  const png = path.join(dir, 'stills', fs.readdirSync(path.join(dir, 'stills')).find((x) => x.startsWith('s01-')));
  assert.ok(pixel(png, 5, 5)[0] < 40);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('without drawtext the contact sheet and animatic still carry shot labels (drawn by Chromium)', opts, () => {
  const dir = makeFilm({ s01: SHOT(''), s02: SHOT('') });
  const r = wkaEnv({ WKA_NO_DRAWTEXT: '1' }, 'animatic', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /不加文字标注/);
  const sheet = path.join(dir, 'review', '接触表.jpg');
  assert.ok(pixel(sheet, 12, 38)[0] < 200, 'label box in the top-left of the first tile');
  assert.ok(pixel(sheet, 600, 300)[0] > 220, 'the rest of the tile is still paper');
  const frame = path.join(dir, 'frame.png');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', '0.5', '-i', path.join(dir, 'review', '动态分镜.mp4'), '-frames:v', '1', frame]);
  assert.ok(pixel(frame, 23, 58)[0] < 200, 'label box in the animatic frame');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a second soundtrack run with per-character cues leaves film.json untouched', () => {
  const dir = makeFilm({ s01: SHOT('') });
  const f = path.join(dir, 'film.json');
  const film = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.mkdirSync(path.join(dir, 'audio'));
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=0.6', path.join(dir, 'audio', 'a.wav')]);
  film.audio = { voice_source: 'user', voices: [{ text: '春眠', at: 0, cue: 'a', chars: true, file: 'audio/a.wav' }, { text: '不觉', at: 0.7, cue: 'b', file: 'audio/a.wav' }] };
  fs.writeFileSync(f, JSON.stringify(film));
  assert.equal(wka('soundtrack', dir).status, 0);
  const first = fs.readFileSync(f, 'utf8');
  const r = wka('soundtrack', dir);
  assert.match(r.stdout, /声音同步点未变化/);
  assert.equal(fs.readFileSync(f, 'utf8'), first);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('renaming a chars voice clears its old per-character cues and keeps hand-written ones', () => {
  const dir = makeFilm({ s01: SHOT('') });
  const f = path.join(dir, 'film.json');
  const film = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.mkdirSync(path.join(dir, 'audio'));
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=0.6', path.join(dir, 'audio', 'a.wav')]);
  film.cues = { 落印: [0.8, 0.9] };
  film.audio = { voice_source: 'user', voices: [{ text: '春眠', at: 0, cue: '甲', chars: true, file: 'audio/a.wav' }] };
  fs.writeFileSync(f, JSON.stringify(film));
  assert.equal(wka('soundtrack', dir).status, 0);
  const renamed = JSON.parse(fs.readFileSync(f, 'utf8'));
  renamed.audio.voices[0].cue = '乙';
  fs.writeFileSync(f, JSON.stringify(renamed));
  const r = wka('soundtrack', dir);
  assert.equal(r.status, 0, r.stderr);
  const keys = Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).cues);
  assert.deepEqual(keys.filter((k) => k.startsWith('甲#')), []);
  assert.deepEqual(keys.filter((k) => k.startsWith('乙#')), ['乙#1', '乙#2']);
  assert.ok(keys.includes('落印'));
  assert.match(r.stdout, /清掉了已不用的逐字同步点：甲#1…#2/);
  // 人声全删了，逐字点也跟着清掉
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), audio: {} }));
  assert.equal(wka('soundtrack', dir).status, 0);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).cues).filter((k) => k.includes('#')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('two voices with the same cue name stop wka soundtrack and leave film.json alone', () => {
  const dir = makeFilm({ s01: SHOT('') });
  const f = path.join(dir, 'film.json');
  const film = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.mkdirSync(path.join(dir, 'audio'));
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=0.3', path.join(dir, 'audio', 'a.wav')]);
  film.audio = { voice_source: 'user', voices: [{ text: '春眠', at: 0, cue: '甲', file: 'audio/a.wav' }, { text: '不觉', at: 0.5, cue: '甲', file: 'audio/a.wav' }] };
  fs.writeFileSync(f, JSON.stringify(film));
  const before = fs.readFileSync(f, 'utf8');
  const r = wka('soundtrack', dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /同步点名重复：「甲」用在第 1、2 条/);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a one-shot film still gets a labelled contact sheet from wka animatic', opts, () => {
  const dir = makeFilm({ s01: SHOT('') });
  const r = wkaEnv({ WKA_NO_DRAWTEXT: '1' }, 'animatic', dir);
  assert.equal(r.status, 0, r.stderr);
  const sheet = path.join(dir, 'review', '接触表.jpg');
  assert.ok(fs.existsSync(sheet), r.stdout);
  assert.ok(pixel(sheet, 14, 20)[0] < 200, 'label box in the top-left');
  assert.ok(pixel(sheet, 600, 300)[0] > 220, 'the rest is still paper');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('without drawtext the QC contact sheet still carries labels (drawn by Chromium)', opts, () => {
  // 一镜只有纸色：采样帧都算「空帧」，会抽出超标帧
  const dir = makeFilm({ s01: SHOT('') });
  assert.equal(wka('render', dir).status, 0);
  const r = wkaEnv({ WKA_NO_DRAWTEXT: '1' }, 'qc', dir);
  assert.equal(r.status, 2, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /不加文字标注/);
  const sheet = path.join(dir, 'stills', 'qc', 'qc-sheet.jpg');
  assert.ok(pixel(sheet, 14, 20)[0] < 200, 'label box in the top-left');
  assert.ok(pixel(sheet, 600, 300)[0] > 220, 'the rest is still paper');
  fs.rmSync(dir, { recursive: true, force: true });
});
