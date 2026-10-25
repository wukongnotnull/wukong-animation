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
