import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { confirmFixtureVoices } from '../helpers/production.mjs';
// Complete preview keeps user recording playable, with no subtitle output.
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
function makeFilm() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-sub-'));
  initializeProduction(dir);fs.mkdirSync(path.join(dir, 'shots'));
  fs.mkdirSync(path.join(dir, 'audio'));
  for (const id of ['s01', 's02']) fs.writeFileSync(path.join(dir, 'shots', `${id}.js`), SHOT);
  tone(path.join(dir, 'audio', 'vo1.wav'), 0.6);
  const film = {
    title: 'sub-it', style: 'ink-wash', size: [W, H], fps: 10, seed: 1,
    shots: ['s01', 's02'].map((id) => ({ id, file: `shots/${id}.js`, duration: 1 })),
    audio: { voice_source: 'user', voices: [{ text: '山不说话。', at: 0.2, file: 'audio/vo1.wav' }] },
    export: { formats: ['mp4'], name: 'out' },
  };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  confirmFixtureVoices(dir);return dir;
}

const wka = (...args) =>
  spawnSync(process.execPath, [WKA, ...args], { encoding: 'utf8', env: { ...process.env, WKA_NO_FONT_DOWNLOAD: '1', WKA_WORKERS: '2' } });

const probe = (file, entries) =>
  spawnSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).stdout.trim();

test('soundtrack and proxy leave playable review copies in review/', opts, () => {
  const dir = makeFilm();
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
  assert.equal(fs.readdirSync(dir,{recursive:true}).some(f=>/\.(srt|vtt)$/.test(f)),false);
  fs.rmSync(dir, { recursive: true, force: true });
});
