// 字幕：wka subtitles 生成 / 不覆盖手改，wka final 按 subtitles.mode 烧录或外挂。需要 browser 管线依赖 + ffmpeg；缺任一项整组跳过。
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
const opts = { skip: (await check()).ok ? false : 'browser 管线依赖未安装（运行 wka setup）' };

const W = 320;
const H = 180;
const SHOT = "wk.shot({ render(ctx, t, s) { ctx.fillStyle = '#F2EDE3'; ctx.fillRect(0, 0, s.W, s.H); } });\n";
const tone = (file, sec) => spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(sec), '-ac', '2', file]);

/** 两镜各 1 秒，纸色底；自供录音人声 1 条（0.2s 起，0.6s 长）。 */
function makeFilm(subtitles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-sub-'));
  fs.mkdirSync(path.join(dir, 'shots'));
  fs.mkdirSync(path.join(dir, 'audio'));
  for (const id of ['s01', 's02']) fs.writeFileSync(path.join(dir, 'shots', `${id}.js`), SHOT);
  tone(path.join(dir, 'audio', 'vo1.wav'), 0.6);
  const film = {
    title: 'sub-it', style: 'ink-wash', size: [W, H], fps: 10, seed: 1,
    shots: ['s01', 's02'].map((id) => ({ id, file: `shots/${id}.js`, duration: 1 })),
    audio: { voice_source: 'user', voices: [{ text: '山不说话。', at: 0.2, file: 'audio/vo1.wav' }] },
    export: { formats: ['mp4'], name: 'out' },
    ...(subtitles ? { subtitles } : {}),
  };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  return dir;
}

const wka = (...args) =>
  spawnSync(process.execPath, [WKA, ...args], { encoding: 'utf8', env: { ...process.env, WKA_NO_FONT_DOWNLOAD: '1', WKA_WORKERS: '2' } });

/** 画面底部 1/3 在 t 秒处的灰度像素。 */
function bottomPixels(video, t) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', `crop=${W}:${H / 3}:0:${(2 * H) / 3},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
  return r.stdout;
}

const probe = (file, entries) =>
  spawnSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).stdout.trim();

/** 两帧最大的像素差：字幕只占几十个像素，看平均差会被纸色底稀释。 */
const maxDiff = (a, b) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

test('wka subtitles does nothing when subtitles.mode is none', opts, () => {
  const dir = makeFilm();
  const r = wka('subtitles', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /none/);
  assert.ok(!fs.existsSync(path.join(dir, 'subtitles.srt')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wka subtitles asks for the measured cues first', opts, () => {
  const dir = makeFilm({ mode: 'srt' });
  const r = wka('subtitles', dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /wka soundtrack/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wka subtitles writes the srt once and keeps hand edits unless --force', opts, () => {
  const dir = makeFilm({ mode: 'srt' });
  assert.equal(wka('soundtrack', dir).status, 0);
  const srt = path.join(dir, 'subtitles.srt');
  let r = wka('subtitles', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(srt, 'utf8'), '1\n00:00:00,200 --> 00:00:00,800\n山不说话\n');

  fs.writeFileSync(srt, '1\n00:00:00,200 --> 00:00:00,800\n山，不说话\n');
  r = wka('subtitles', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--force/);
  assert.match(fs.readFileSync(srt, 'utf8'), /山，不说话/);

  r = wka('subtitles', dir, '--force');
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(srt, 'utf8'), /^1\n.*\n山不说话\n$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mode burn: only out_有字幕.mp4, showing the subtitle only while it is on', opts, () => {
  const dir = makeFilm({ mode: 'burn' });
  assert.equal(wka('soundtrack', dir).status, 0);
  assert.equal(wka('subtitles', dir).status, 0);
  const r = wka('final', dir);
  assert.equal(r.status, 0, r.stderr);
  const out = path.join(dir, 'out_有字幕.mp4');
  const clean = path.join(dir, '.cache', 'video.mp4');
  assert.ok(maxDiff(bottomPixels(out, 0.5), bottomPixels(clean, 0.5)) > 100, 'subtitle visible at 0.5s');
  assert.ok(maxDiff(bottomPixels(out, 1.5), bottomPixels(clean, 1.5)) < 30, 'nothing at 1.5s');
  for (const f of ['out.mp4', 'out_无字幕.mp4', 'out_字幕.srt']) assert.ok(!fs.existsSync(path.join(dir, f)), f);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mode srt: out_无字幕.mp4 without burned subtitles plus out_字幕.srt', opts, () => {
  const dir = makeFilm({ mode: 'srt' });
  assert.equal(wka('soundtrack', dir).status, 0);
  assert.equal(wka('subtitles', dir).status, 0);
  const r = wka('final', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'out_字幕.srt'), 'utf8'), fs.readFileSync(path.join(dir, 'subtitles.srt'), 'utf8'));
  assert.ok(maxDiff(bottomPixels(path.join(dir, 'out_无字幕.mp4'), 0.5), bottomPixels(path.join(dir, '.cache', 'video.mp4'), 0.5)) < 30);
  assert.ok(!fs.existsSync(path.join(dir, 'out_有字幕.mp4')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mode both: a burned and a clean mp4 plus the srt', opts, () => {
  const dir = makeFilm({ mode: 'both' });
  assert.equal(wka('soundtrack', dir).status, 0);
  assert.equal(wka('subtitles', dir).status, 0);
  const r = wka('final', dir);
  assert.equal(r.status, 0, r.stderr);
  const clean = path.join(dir, '.cache', 'video.mp4');
  assert.ok(maxDiff(bottomPixels(path.join(dir, 'out_有字幕.mp4'), 0.5), bottomPixels(clean, 0.5)) > 100);
  assert.ok(maxDiff(bottomPixels(path.join(dir, 'out_无字幕.mp4'), 0.5), bottomPixels(clean, 0.5)) < 30);
  assert.ok(fs.existsSync(path.join(dir, 'out_字幕.srt')));
  const delivery=wka('delivery',dir,'--host','codex','--json');
  assert.equal(delivery.status,0,delivery.stdout+delivery.stderr);
  const delivered=JSON.parse(delivery.stdout);
  for(const name of ['out_有字幕.mp4','out_无字幕.mp4','out_字幕.srt'])assert.equal(delivered.items.find(i=>i.path===path.join(dir,name)).status,'current');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('film.json subtitles.style overrides the style subtitle look', opts, () => {
  const burnt = (subtitles) => {
    const dir = makeFilm(subtitles);
    assert.equal(wka('soundtrack', dir).status, 0);
    assert.equal(wka('subtitles', dir).status, 0);
    const r = wka('final', dir);
    assert.equal(r.status, 0, r.stderr);
    const px = bottomPixels(path.join(dir, 'out_有字幕.mp4'), 0.5);
    fs.rmSync(dir, { recursive: true, force: true });
    return px;
  };
  const plain = burnt({ mode: 'burn' });
  // ink-wash 的字幕是墨色字，覆盖成白字才看得出差别
  const white = burnt({ mode: 'burn', style: { color: '#FFFFFF' } });
  assert.ok(maxDiff(plain, white) > 100);
});

test('soundtrack and proxy leave playable review copies in review/', opts, () => {
  const dir = makeFilm({ mode: 'srt' });
  let r = wka('soundtrack', dir);
  assert.equal(r.status, 0, r.stderr);
  const m4a = path.join(dir, 'review', '声轨.m4a');
  assert.ok(r.stdout.includes(m4a), 'absolute path in the log');
  assert.equal(probe(m4a, 'stream=codec_name'), 'aac');
  assert.ok(Math.abs(Number(probe(m4a, 'format=duration')) - Number(probe(path.join(dir, '.cache', 'mix.wav'), 'format=duration'))) < 0.1);
  r = wka('render', dir, '--proxy');
  assert.equal(r.status, 0, r.stderr);
  const proxy = path.join(dir, 'review', '小样.mp4');
  assert.ok(r.stdout.includes(proxy), 'absolute path in the log');
  assert.equal(probe(proxy, 'stream=codec_type'), 'video\naudio');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wka final stops when the srt is missing', opts, () => {
  const dir = makeFilm({ mode: 'srt' });
  const r = wka('final', dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /wka subtitles/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wka subtitles --preview burns the subtitles onto the proxy', opts, () => {
  const dir = makeFilm({ mode: 'srt' });
  assert.equal(wka('soundtrack', dir).status, 0);
  assert.equal(wka('render', dir, '--proxy').status, 0);
  const r = wka('subtitles', dir, '--preview');
  assert.equal(r.status, 0, r.stderr);
  const out = path.join(dir, 'review', '字幕预览.mp4');
  assert.ok(fs.existsSync(out));
  assert.ok(r.stdout.includes(`字幕预览：${out}`));
  assert.ok(!fs.existsSync(path.join(dir, 'out-proxy-subtitled.mp4')));
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 底部 1/3 里与无字幕画面差得明显的最上面一行（没有就 -1）。 */
const topRow = (a, b) => {
  for (let y = 0; y < H / 3; y++) for (let x = 0; x < W; x++) if (Math.abs(a[y * W + x] - b[y * W + x]) > 100) return y;
  return -1;
};

test('双语：wka subtitles 生成英文稿并报待填；没填完 final 报错；填好后烧两行并外挂英文 srt', opts, () => {
  const dir = makeFilm({ mode: 'both', bilingual: true });
  assert.equal(wka('soundtrack', dir).status, 0);
  const r = wka('subtitles', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /英文字幕 1 条，其中 1 条待填/);
  const enFile = path.join(dir, 'subtitles.en.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(enFile, 'utf8')), [{ zh: '山不说话', en: '' }]);
  const blank = wka('final', dir);
  assert.notEqual(blank.status, 0);
  assert.match(blank.stderr, /还有 1 条英文没填：第 1 条/);

  fs.writeFileSync(enFile, JSON.stringify([{ zh: '山不说话', en: 'The mountain is silent' }]));
  assert.match(wka('subtitles', dir).stdout, /英文字幕 1 条，其中 0 条待填/);
  const f = wka('final', dir);
  assert.equal(f.status, 0, f.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'out_英文字幕.srt'), 'utf8'), fs.readFileSync(path.join(dir, 'subtitles.srt'), 'utf8').replace('山不说话', 'The mountain is silent'));

  const mono = makeFilm({ mode: 'burn' });
  assert.equal(wka('soundtrack', mono).status, 0);
  assert.equal(wka('subtitles', mono).status, 0);
  assert.ok(!fs.existsSync(path.join(mono, 'subtitles.en.json')), '单语片子不生成英文稿');
  assert.equal(wka('final', mono).status, 0);
  const rows = (d, file) => topRow(bottomPixels(path.join(d, file), 0.5), bottomPixels(path.join(d, '.cache', 'video.mp4'), 0.5));
  const [two, one] = [rows(dir, 'out_有字幕.mp4'), rows(mono, 'out_有字幕.mp4')];
  assert.ok(one > 0 && two >= 0 && one - two >= 8, `双语字幕顶边 ${two}，单语 ${one}：应高出约一行`);
  for (const d of [dir, mono]) fs.rmSync(d, { recursive: true, force: true });
});
