// wka sfx / wka soundtrack 接录音音效库。不联网：在临时的 WUKONG_ANIMATION_HOME 里预置处理好的音效。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasFfmpeg } from '../../plugin/engine/core/ffmpeg.mjs';
import * as synth from '../../plugin/engine/audio/synth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WKA = path.join(ROOT, 'plugin/engine/bin/wka.mjs');
const opts = { skip: hasFfmpeg() ? false : '需要 ffmpeg' };

const BUILD = `export default async function ({ synth, sfx, duration, outDir }) {
  const buf = synth.buffer(duration);
  sfx.place(buf, 'ding', { at: 0.5 });
  sfx.place(buf, 'ding', { at: 1.5 });
  sfx.place(buf, 'click', { at: 3 });
  return [{ file: synth.writeWav(buf, outDir + '/sfx.wav'), start: 0, gain: 0 }];
}
`;

function makeFilm(style) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-sfx-it-'));
  fs.mkdirSync(path.join(dir, 'audio'));
  fs.writeFileSync(path.join(dir, 'audio', 'build.mjs'), BUILD);
  const film = {
    title: 'it', style, size: [320, 180], fps: 30, seed: 1,
    shots: [{ id: 's01', file: 's01.tsx', duration: 2 }, { id: 's02', file: 's02.tsx', duration: 2 }],
    audio: { build: 'audio/build.mjs' },
  };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  return dir;
}

/** 临时用户目录，预置 keynote 的 ding、click 两个"已处理"音效。 */
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-home-'));
  const dir = path.join(home, 'cache', 'sfx', 'keynote');
  for (const name of ['ding', 'click']) {
    const buf = synth.buffer(0.2);
    buf.L.fill(0.5);
    buf.R.fill(0.5);
    synth.writeWav(buf, path.join(dir, `${name}.wav`));
  }
  return home;
}

const wka = (home, ...args) => spawnSync(process.execPath, [WKA, ...args], { encoding: 'utf8', env: { ...process.env, WUKONG_ANIMATION_HOME: home, WKA_NO_FONT_DOWNLOAD: '1' } });

test('wka soundtrack 把 sfx 交给配乐脚本，写出 sfx.wav，并提示一镜两个 ding', opts, () => {
  const home = makeHome();
  const dir = makeFilm('keynote');
  const r = wka(home, 'soundtrack', dir);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.existsSync(path.join(dir, 'audio', 'generated', 'sfx.wav')));
  assert.ok(fs.existsSync(path.join(dir, '.cache', 'mix.wav')));
  assert.match(r.stdout, /s01 里有 2 个 ding/);
  assert.doesNotMatch(r.stdout, /s02 里/);
  for (const d of [home, dir]) fs.rmSync(d, { recursive: true, force: true });
});

test('配乐脚本用了没下载的音效：wka soundtrack 报错并指向 wka sfx', opts, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-home-'));
  const dir = makeFilm('keynote');
  const r = wka(home, 'soundtrack', dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /还没下载.*wka sfx/s);
  for (const d of [home, dir]) fs.rmSync(d, { recursive: true, force: true });
});

test('风格没有音效清单：wka sfx 报错', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-home-'));
  const dir = makeFilm('ink-wash');
  const r = wka(home, 'sfx', dir, '--list');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /风格 ink-wash 没有录音音效清单/);
  for (const d of [home, dir]) fs.rmSync(d, { recursive: true, force: true });
});
