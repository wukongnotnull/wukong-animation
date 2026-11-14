import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WKA = fileURLToPath(new URL('../../plugin/engine/bin/wka.mjs', import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-timeline-home-'));
const env = { ...process.env, WUKONG_ANIMATION_HOME: home, WKA_NO_FONT_DOWNLOAD: '1' };
const cli = (...args) => spawnSync(process.execPath, [WKA, ...args], { env, encoding: 'utf8', maxBuffer: 8e6 });
const styleDir = path.join(home, 'styles', 'timeline-browser');
fs.mkdirSync(styleDir, { recursive: true });
fs.writeFileSync(path.join(styleDir, 'style.json'), JSON.stringify({ id: 'timeline-browser', name: '词表测试', category: 'xinxi', order: 997, engine: '>=0.1.0', pipeline: 'browser', kits: {}, fps: 30, aspects: ['16:9'], keywords: ['test'] }));

function project(text, tokens) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-timeline-film-'));
  initializeProduction(dir);fs.mkdirSync(path.join(dir, 'shots'));fs.mkdirSync(path.join(dir, 'audio'));
  const wave = path.join(dir, 'voice.wav');
  const tone = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='0.3*sin(2*PI*220*t)*(between(t,0.5,0.9)+between(t,1.5,2.0))':s=16000:d=2.4", wave]);
  assert.equal(tone.status, 0, String(tone.stderr));
  const shot = `wk.shot({render(ctx,t,s){const f=s.frame;const a=f>=s.cueFrame('word:v01:1')?255:0,b=f>=s.cueFrame('word:v01:3')?255:0;ctx.fillStyle='rgb('+[a,b,0].join(',')+')';ctx.fillRect(0,0,s.W,s.H);}});`;
  fs.writeFileSync(path.join(dir, 'shots', 's01.js'), "wk.shot({render(ctx,t,s){ctx.fillStyle='black';ctx.fillRect(0,0,s.W,s.H);}})");
  fs.writeFileSync(path.join(dir, 'shots', 's02.js'), shot);
  fs.writeFileSync(path.join(dir, 'audio', 'build.mjs'), "import fs from 'node:fs';import path from 'node:path';export default async ({ outDir, cues }) => { fs.writeFileSync(path.join(outDir, 'seen-cues.json'), JSON.stringify(cues)); return []; };");
  const film = { title: 'timeline', style: 'timeline-browser', size: [32, 18], fps: 30, seed: 1, shots: [{ id: 's01', file: 'shots/s01.js', duration: 0.17 }, { id: 's02', file: 'shots/s02.js', duration: 2.6 }], audio: { voice_source: 'user', build: 'audio/build.mjs', voices: [{ cue: 'v01', file: 'voice.wav', at: 0.17, text }] } };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  const tool = path.join(dir, 'local recognizer'), model = path.join(dir, 'local model.bin');
  fs.writeFileSync(model, 'contract fixture, not an actual model');
  const rows = tokens.map(([word, from, to, p = 0.95]) => ({ text: word, offsets: { from, to }, p }));
  fs.writeFileSync(tool, `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);if(args.includes('--help'))process.exit(0);const prefix=args[args.indexOf('-of')+1];fs.writeFileSync(prefix+'.json',JSON.stringify({args,transcription:[{text:${JSON.stringify(text)},offsets:{from:0,to:2400},tokens:${JSON.stringify(rows)}}]}));`, { mode: 0o700 });
  return { dir, tool, model };
}
const tokens = [['有', 430, 600], ['素', 600, 780], ['材', 780, 970], ['无', 1420, 1700], ['素材', 1700, 2070]];

test('无镜头人声 CLI 可定位、查看和导入词表，混音与渲染仍拒绝空时间轴', { timeout: 300000 }, () => {
  const { dir, tool, model } = project('有素材无素材', tokens);
  try {
    const file = path.join(dir, 'film.json'), film = JSON.parse(fs.readFileSync(file));
    film.shots = [];film.audio.voices[0].at = 20;fs.writeFileSync(file, JSON.stringify(film));
    fs.rmSync(path.join(dir, 'shots'), { recursive: true });
    const aligned = cli('align-voice', dir, '--binary', tool, '--model', model);
    assert.equal(aligned.status, 0, aligned.stderr + aligned.stdout);
    assert.match(aligned.stdout, /逐词时间表已生成/);
    for (const args of [[], ['--words']]) {
      const checked = cli('align-voice', dir, ...args, '--status');assert.equal(checked.status, 0, checked.stderr);
      assert.equal(JSON.parse(checked.stdout).ready, true);
    }
    const timeline = JSON.parse(fs.readFileSync(path.join(dir, '.wka/word-timeline.json'))), voice = timeline.voices.v01;
    const input = path.join(dir, 'manual.json');fs.writeFileSync(input, JSON.stringify({ version: 1, voices: { v01: { source: voice.source, words: [voice.words[0]] } } }));
    const imported = cli('align-voice', dir, '--import', input, '--confirm', '用户确认录音内时间');assert.equal(imported.status, 0, imported.stderr);
    for (const command of ['soundtrack', 'render']) {
      const rejected = cli(command, dir);assert.notEqual(rejected.status, 0);assert.match(rejected.stderr + rejected.stdout, /镜头|时间轴/);
    }
    const dtwModel = path.join(dir, 'ggml-base.bin');fs.copyFileSync(model, dtwModel);
    fs.writeFileSync(tool, `#!${process.execPath}\nif(process.argv.includes('--help'))process.exit(0);process.stderr.write('word generation failed');process.exit(2);`);
    fs.rmSync(path.join(dir, '.wka/word-timeline.json'));
    const warned = cli('align-voice', dir, '--binary', tool, '--model', dtwModel);assert.equal(warned.status, 0, warned.stderr + warned.stdout);assert.match(warned.stdout, /逐词时间表未生成/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('逐词 cue 驱动镜头词首帧与配乐脚本；align-voice 默认生成词表', { timeout: 300000 }, () => {
  const { dir, tool, model } = project('有素材无素材', tokens);
  try {
    const aligned = cli('align-voice', dir, '--binary', tool, '--model', model);
    assert.match(aligned.stdout, /逐词时间表/, aligned.stderr + aligned.stdout);
    const timeline = JSON.parse(fs.readFileSync(path.join(dir, '.wka/word-timeline.json'), 'utf8'));
    const words = timeline.voices.v01.words;
    assert.equal(words.length, 4);
    assert.ok(fs.existsSync(path.join(dir, 'review/台词/逐词时间表.md')));
    const track = cli('soundtrack', dir);
    assert.equal(track.status, 0, track.stderr + track.stdout);
    const seen = JSON.parse(fs.readFileSync(path.join(dir, 'audio/generated/seen-cues.json'), 'utf8'));
    assert.ok(Math.abs(seen['word:v01:1'][0] - (0.17 + words[0].start)) < 1e-6, '配乐脚本拿到全片秒的词 cue');
    assert.ok(Math.abs(seen['word:v01:3'][0] - (0.17 + words[2].start)) < 1e-6);
    const render = cli('render', dir);
    assert.equal(render.status, 0, render.stderr + render.stdout.slice(-2000));
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(dir, '.cache/16x9/video.mp4'), '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1e6 });
    assert.equal(decoded.status, 0, String(decoded.stderr));
    [[0, words[0]], [1, words[2]]].forEach(([channel, word]) => {
      let first = -1;
      for (let n = 0; n < decoded.stdout.length / 3; n++) if (decoded.stdout[n * 3 + channel] > 180) { first = n;break; }
      assert.ok(first >= 0);
      assert.ok(Math.abs(first / 30 - (0.17 + word.start)) <= 1 / 30 + 1e-6, `词 ${word.n}：${first / 30} 对 ${0.17 + word.start}`);
    });
    const film = JSON.parse(fs.readFileSync(path.join(dir, 'film.json'), 'utf8'));
    assert.equal(Object.keys(film.cues || {}).some(key => key.startsWith('word:')), false, '词 cue 不写进 film.json');

    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('句段定位通过但有词待确认：镜头用到该词时渲染明确失败，不改用估算时间', { timeout: 300000 }, () => {
  const { dir, tool, model } = project('有素材无素材', tokens.map(([word, from, to]) => (word === '无' ? [word, from, to, 0.2] : [word, from, to])));
  try {
    const aligned = cli('align-voice', dir, '--binary', tool, '--model', model);
    assert.equal(aligned.status, 0, aligned.stderr + aligned.stdout);
    assert.match(aligned.stdout, /1 个待确认词/);
    const pending = cli('render', dir);
    assert.notEqual(pending.status, 0);
    assert.match(pending.stderr + pending.stdout, /word:v01:3 不可用：词“无”是 pending/);
    const status = cli('align-voice', dir, '--words', '--status');
    assert.equal(status.status, 2);
    assert.equal(JSON.parse(status.stdout).voices.v01.status, 'pending');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
