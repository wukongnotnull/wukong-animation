import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { alignWords, importWordTiming, wordTimelineCues, wordTimelineStatus } from '../../plugin/engine/audio/word-timeline.mjs';
import { dtwPreset, recognitionTokens, voiceAlignmentStatus } from '../../plugin/engine/audio/voice-alignment.mjs';
import { loadFilm } from '../../plugin/engine/core/film-context.mjs';

const RATE = 16000;
function wave(file, bursts, seconds) {
  const samples = Math.round(seconds * RATE), bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length - 8, 4);bytes.write('WAVEfmt ', 8);bytes.writeUInt32LE(16, 16);bytes.writeUInt16LE(1, 20);bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(RATE, 24);bytes.writeUInt32LE(RATE * 2, 28);bytes.writeUInt16LE(2, 32);bytes.writeUInt16LE(16, 34);bytes.write('data', 36);bytes.writeUInt32LE(samples * 2, 40);
  for (const [from, to] of bursts) for (let at = Math.round(from * RATE); at < Math.round(to * RATE); at++) bytes.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 220 * at) / RATE)), 44 + at * 2);
  fs.writeFileSync(file, bytes);
}
const tokenRows = [['有', 430, 600], ['素', 600, 780], ['材', 780, 970], ['无', 1420, 1700], ['素材', 1700, 2070]];
function fixture(t, { text = '有素材无素材', tokens = tokenRows, withTool = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '词表 '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initializeProduction(dir);
  wave(path.join(dir, '原声.wav'), [[0.5, 0.9], [1.5, 2.0]], 2.4);
  const film = { title: '片', style: 'ink-wash', size: [160, 90], fps: 10, seed: 1, shots: [{ id: 's01', file: 's01.js', duration: 5 }], audio: { voice_source: 'user', voices: [{ cue: 'v01', file: '原声.wav', at: 1, text }] } };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  const tool = path.join(dir, 'local recognizer'), model = path.join(dir, 'local model.bin');
  fs.writeFileSync(model, 'contract fixture, not an actual model');
  const rows = tokens.map(([word, from, to, p = 0.95]) => ({ text: word, offsets: { from, to }, p }));
  fs.writeFileSync(tool, `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);if(args.includes('--help'))process.exit(0);const prefix=args[args.indexOf('-of')+1];fs.writeFileSync(prefix+'.json',JSON.stringify({args,transcription:[{text:${JSON.stringify(text)},offsets:{from:0,to:2400},tokens:${JSON.stringify(rows)}}]}));`, { mode: 0o700 });
  return { dir, film, tool, model, options: withTool ? { binary: tool, model, log() {} } : {} };
}
const ctxOf = dir => loadFilm(dir, { requireShots: false });

test('DTW 预设只按官方模型文件名启用；有 DTW 时间时作为 token 起点', () => {
  assert.equal(dtwPreset('/a/ggml-small.bin'), 'small');
  assert.equal(dtwPreset('ggml-base.en-q5_1.bin'), 'base.en');
  assert.equal(dtwPreset('ggml-large-v3-turbo.bin'), 'large.v3.turbo');
  assert.equal(dtwPreset('ggml-large-v3.bin'), 'large.v3');
  assert.equal(dtwPreset('local model.bin'), null);
  const raw = { transcription: [{ tokens: [{ text: '[_BEG_]', offsets: { from: 0, to: 0 }, t_dtw: -1 }, { text: '你', offsets: { from: 0, to: 500 }, t_dtw: 20, p: 0.9 }, { text: '好', offsets: { from: 500, to: 900 }, t_dtw: 60, p: 0.9 }] }] };
  assert.deepEqual(recognitionTokens(raw).map(token => [token.text, token.from, token.to]), [['你', 0.2, 0.6], ['好', 0.6, 1.0]]);
  raw.transcription[0].tokens[1].t_dtw = -1;
  assert.equal(recognitionTokens(raw)[0].from, 0);
});

test('align-words 生成词表：词边界吸附到音频，写出可读表且不产生字幕文件', async t => {
  const { dir, options } = fixture(t);
  const status = await alignWords(dir, options);
  assert.equal(status.ready, true);
  const words = status.voices.v01.words;
  assert.equal(words.map(word => word.text).join(''), '有素材无素材');
  assert.ok(Math.abs(words[0].start - 0.5) <= 0.03 && Math.abs(words.at(-1).end - 2.0) <= 0.03);
  assert.ok(words.every(word => word.status === 'measured'));
  const report = fs.readFileSync(path.join(dir, 'review/逐词时间表.md'), 'utf8');
  assert.match(report, /\| 序号 \| 词 \|/);assert.match(report, /word:v01:<序号>/);
  assert.equal(fs.readdirSync(dir, { recursive: true }).some(file => /\.(srt|vtt)$/.test(file)), false);
  const { cues, evidence } = wordTimelineCues(ctxOf(dir));
  assert.deepEqual(Object.keys(cues), words.map(word => `word:v01:${word.n}`));
  assert.ok(Math.abs(cues['word:v01:1'][0] - 1.5) <= 0.03, '全片时间 = 录音起点 + 词时间');
  assert.equal(evidence['word:v01:1'].verified, true);
});

test('对不上原稿的词是 pending，不注册 cue；人工确认后可用，且必须绑定当前来源', async t => {
  const { dir, options } = fixture(t, { text: '有素材无声音' });
  const status = await alignWords(dir, options);
  assert.equal(status.ready, false);
  const pending = status.voices.v01.words.filter(word => word.status === 'pending');
  assert.ok(pending.length >= 1);
  const before = wordTimelineCues(ctxOf(dir));
  const key = `word:v01:${pending[0].n}`;
  assert.equal(Object.hasOwn(before.cues, key), false);
  assert.match(before.unavailable[key], /pending/);
  const source = status.voices.v01.source, word = pending[0];
  const input = { version: 1, voices: { v01: { source, words: [{ n: word.n, text: word.text, start: word.start, end: word.end }] } } };
  assert.throws(() => importWordTiming(dir, input), /确认/);
  assert.throws(() => importWordTiming(dir, { ...input, voices: { v01: { source: { ...source, at: 9 }, words: input.voices.v01.words } } }, { confirmation: '用户确认' }), /来源|过期/);
  assert.throws(() => importWordTiming(dir, { ...input, voices: { v01: { source, words: [{ ...input.voices.v01.words[0], text: '别的词' }] } } }, { confirmation: '用户确认' }), /不一致/);
  assert.throws(() => importWordTiming(dir, { ...input, voices: { v01: { source, words: [{ ...input.voices.v01.words[0], start: 0, end: 2.4 }] } } }, { confirmation: '用户确认' }), /重叠|无效/);
  const confirmed = importWordTiming(dir, input, { confirmation: '用户听审后确认这些时间' });
  assert.equal(confirmed.voices.v01.status, 'confirmed');
  assert.equal(Object.hasOwn(wordTimelineCues(ctxOf(dir)).cues, key), true);
  const again = await alignWords(dir, { ...options, force: true });
  assert.equal(again.voices.v01.words.find(item => item.n === word.n).status, 'confirmed', '重算不丢用户已确认的词');
});

test('录音、原稿或起点变化后词表过期，cue 全部不可用并说明原因', async t => {
  const { dir, film, options } = fixture(t);
  await alignWords(dir, options);
  film.audio.voices[0].at = 1.5;
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  assert.equal(wordTimelineStatus(ctxOf(dir)).voices.v01.status, 'stale');
  const result = wordTimelineCues(ctxOf(dir));
  assert.deepEqual(result.cues, {});
  assert.match(result.unavailable.v01, /过期/);
});

test('没有原稿时词表来自识别文字；没有词表文件时不产生 cue', async t => {
  const { dir, options } = fixture(t, { text: '' });
  assert.deepEqual(wordTimelineCues(ctxOf(dir)), { cues: {}, evidence: {}, unavailable: {} });
  const status = await alignWords(dir, options);
  assert.equal(status.voices.v01.words.map(word => word.text).join(''), '有素材无素材');
  assert.equal(voiceAlignmentStatus(dir).voices.v01.status, 'missing', '词表不改变句段定位状态');
});

test('损坏的词表记录不会被当作可用或被覆盖', async t => {
  const { dir, options } = fixture(t);
  await alignWords(dir, options);
  const record = path.join(dir, '.wka/word-timeline.json'), good = fs.readFileSync(record), bad = JSON.parse(good);
  bad.voices.v01.words[1].start = 99;
  fs.writeFileSync(record, JSON.stringify(bad));
  assert.throws(() => wordTimelineStatus(ctxOf(dir)), /无效|范围/);
  fs.writeFileSync(record, JSON.stringify({ version: 2, voices: {} }));
  await assert.rejects(() => alignWords(dir, options), /损坏|版本/);
});
