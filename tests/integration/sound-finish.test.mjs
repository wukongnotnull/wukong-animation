// wka soundtrack：背景音乐随人声闪避、两遍母带到风格响度、音效听感审计。不联网：人声和音效都用合成的 wav。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasFfmpeg } from '../../plugin/engine/core/ffmpeg.mjs';
import * as synth from '../../plugin/engine/audio/synth.mjs';
import { DUCK_DEPTH } from '../../plugin/engine/audio/duck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WKA = path.join(ROOT, 'plugin/engine/bin/wka.mjs');
const opts = { skip: hasFfmpeg() ? false : '需要 ffmpeg' };

const VOICE = { at: 2, seconds: 2.5 };
const BUILD = `export default async function ({ synth, sfx, duration, outDir }) {
  const bgm = synth.buffer(duration);
  synth.bed(bgm, { gain: 0.5 });
  const tracks = [{ file: synth.writeWav(bgm, outDir + '/bgm.wav'), start: 0, gain: -6, duck: true }];
  if (sfx) {
    const fx = synth.buffer(duration);
    sfx.place(fx, 'ding', { at: 3, volume: 0.02 }); // 压在人声下面、很轻：应被审计报出
    sfx.place(fx, 'ding', { at: 6 });               // 停顿里：不报
    tracks.push({ file: synth.writeWav(fx, outDir + '/sfx.wav'), start: 0, gain: 0 });
  }
  return tracks;
}
`;

/** 类似人声的信号：200 Hz 加音节式起伏。 */
function voiceWav(file) {
  const buf = synth.buffer(VOICE.seconds);
  for (let i = 0; i < buf.L.length; i++) {
    const t = i / buf.sr;
    buf.L[i] = buf.R[i] = 0.3 * Math.sin(2 * Math.PI * 200 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t));
  }
  return synth.writeWav(buf, file);
}

function makeFilm(style) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-sound-it-'));
  fs.mkdirSync(path.join(dir, 'audio'));
  fs.writeFileSync(path.join(dir, 'audio', 'build.mjs'), BUILD);
  voiceWav(path.join(dir, 'vo.wav'));
  const film = {
    title: 'it', style, size: [320, 180], fps: 30, seed: 1,
    shots: [{ id: 's01', file: 's01.js', duration: 4 }, { id: 's02', file: 's02.js', duration: 4 }],
    audio: { build: 'audio/build.mjs', voice_source: 'user', voices: [{ text: '测试一句人声', at: VOICE.at, file: 'vo.wav', cue: '人声' }] },
  };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  return dir;
}

/** 临时用户目录，预置 keynote 的 ding。 */
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-home-'));
  const buf = synth.buffer(0.3);
  for (let i = 0; i < buf.L.length; i++) buf.L[i] = buf.R[i] = 0.8 * Math.sin((2 * Math.PI * 1500 * i) / buf.sr);
  synth.writeWav(buf, path.join(home, 'cache', 'sfx', 'keynote', 'ding.wav'));
  return home;
}

const wka = (home, ...args) => spawnSync(process.execPath, [WKA, ...args], { encoding: 'utf8', env: { ...process.env, WUKONG_ANIMATION_HOME: home, WKA_NO_FONT_DOWNLOAD: '1' } });

function lufs(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  return +[...r.stderr.matchAll(/^\s+I:\s+(-?[\d.]+) LUFS/gm)].at(-1)[1];
}

/** from–to 秒的 RMS（单声道）。 */
function rms(file, from, to) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ss', String(from), '-t', String(to - from), '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const s = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length));
  return Math.sqrt(s.reduce((a, v) => a + v * v, 0) / s.length);
}

test('keynote：背景音乐在人声下闪避，声轨落在 -14 LUFS，审计报出被盖住的音效', opts, () => {
  const home = makeHome();
  const dir = makeFilm('keynote');
  const r = wka(home, 'soundtrack', dir);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const gen = path.join(dir, 'audio', 'generated');
  const ducked = path.join(gen, 'ducked', 'bgm.wav');
  assert.ok(fs.existsSync(ducked));
  // 人声中段：闪避后 / 原始 ≈ DUCK_DEPTH；停顿处不变
  const mid = [VOICE.at + 0.5, VOICE.at + 2];
  assert.ok(Math.abs(rms(ducked, ...mid) / rms(path.join(gen, 'bgm.wav'), ...mid) - DUCK_DEPTH) < 0.03);
  assert.ok(Math.abs(rms(ducked, 6, 7) / rms(path.join(gen, 'bgm.wav'), 6, 7) - 1) < 0.03);
  const mix = path.join(dir, '.cache', 'mix.wav');
  assert.ok(Math.abs(lufs(mix) + 14) <= 0.5, `mix ${lufs(mix)} LUFS`);
  assert.match(r.stdout, /响度 -1[34]\.\d LUFS（目标 -14）/);
  assert.match(r.stdout, /共 2 个音效，1 个被盖住/);
  assert.match(r.stdout, /! 0:03\.00\s+s01\s+ding/);
  // 叠加超过 0 dBFS 时不能在测响度之前削波：premix 用 32 位浮点
  const codec = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', path.join(dir, '.cache', 'premix.wav')], { encoding: 'utf8' }).stdout.trim();
  assert.equal(codec, 'pcm_f32le');
  for (const d of [home, dir]) fs.rmSync(d, { recursive: true, force: true });
});

test('ink-wash：没写 loudness 的风格仍按 -18 LUFS', opts, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-home-'));
  const dir = makeFilm('ink-wash');
  const r = wka(home, 'soundtrack', dir);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const mix = path.join(dir, '.cache', 'mix.wav');
  assert.ok(Math.abs(lufs(mix) + 18) <= 0.5, `mix ${lufs(mix)} LUFS`);
  assert.doesNotMatch(r.stdout, /听感审计/);
  for (const d of [home, dir]) fs.rmSync(d, { recursive: true, force: true });
});
