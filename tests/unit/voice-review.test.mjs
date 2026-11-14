import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeProduction, commitSignoff, nextProductionStep } from '../../plugin/engine/core/state.mjs';
import { voiceAlignmentStatus, importVoiceTiming, applyVoiceAlignment } from '../../plugin/engine/audio/voice-alignment.mjs';
import { voiceReviewStatus } from '../../plugin/engine/core/voice-review.mjs';
import { deliveryReport } from '../../plugin/engine/core/delivery.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-voice-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initializeProduction(dir);
  const wav = Buffer.alloc(44 + 64000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  fs.writeFileSync(path.join(dir, 'voice.wav'), wav);
  fs.writeFileSync(path.join(dir, 'story.md'), '# 剧本\n\n你好世界');
  const film = { title: '人声先行', style: 'ink-wash', size: [160, 90], fps: 10, seed: 1, shots: [], audio: { voice_source: 'user', voices: [{ cue: 'voice', file: 'voice.wav', text: '你好世界', at: 0 }] } };
  const save = value => fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(value));
  save(film);
  return { dir, film, save };
}
function align(dir) {
  const source = voiceAlignmentStatus(dir).voices.voice.source;
  importVoiceTiming(dir, { version: 1, voices: { voice: { source, segments: [{ text: '你好', start: 0, end: 1 }, { text: '世界', start: 1, end: 2 }] } } }, { confirmation: '用户核对原稿并试听确认' });
  applyVoiceAlignment(dir);
}
function approve(dir) {
  const review = voiceReviewStatus(dir);
  assert.equal(review.ready, true, review.issues.join(';'));
  commitSignoff(dir, { id: 'voice-approved', step: 4, note: '人声通过', signature: review.signature, voice: { signature: review.signature } });
  return review.signature;
}

test('无分镜可验收完整录音，逐词表不作为人声签批硬门', t => {
  const { dir } = fixture(t); align(dir);
  assert.equal(voiceReviewStatus(dir).ready, true);
  assert.equal(voiceReviewStatus(dir).approved, false);
  approve(dir);
  assert.equal(voiceReviewStatus(dir, { requireApproval: true }).ready, true);
  assert.equal(voiceReviewStatus(dir).approved, true);
});

test('整体平移不返审人声，但必须重映射全片句段；改稿和改音需要返审', t => {
  const { dir, save } = fixture(t); align(dir); const signature = approve(dir);
  const film = JSON.parse(fs.readFileSync(path.join(dir, 'film.json')));
  save({ ...film, shots: [{ id: 's01', file: 'missing.js', duration: 8 }], audio: { ...film.audio, voices: film.audio.voices.map(v => ({ ...v, at: 3 })) } });
  assert.equal(voiceReviewStatus(dir).signature, signature);
  assert.equal(voiceReviewStatus(dir).approved, true);
  assert.equal(voiceAlignmentStatus(dir).applied, false);
  applyVoiceAlignment(dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'film.json'))).cues['speech:voice:1'], [3, 4]);
  assert.equal(voiceReviewStatus(dir).approved, true);
  fs.writeFileSync(path.join(dir, 'story.md'), '修改后的剧本');
  assert.equal(voiceReviewStatus(dir).approved, false);
  fs.writeFileSync(path.join(dir, 'story.md'), '# 剧本\n\n你好世界');
  const bytes = fs.readFileSync(path.join(dir, 'voice.wav')); bytes.writeInt16LE(10, 100); fs.writeFileSync(path.join(dir, 'voice.wav'), bytes);
  assert.equal(voiceReviewStatus(dir).approved, false);
});

test('修正句段必须重新应用和签批，pending逐词不使句段签批过期', t => {
  const { dir } = fixture(t); align(dir); approve(dir);
  fs.writeFileSync(path.join(dir, '.wka/word-timeline.json'), JSON.stringify({ version: 1, voices: {} }));
  assert.equal(voiceReviewStatus(dir).approved, true);
  const source = voiceAlignmentStatus(dir).voices.voice.source;
  importVoiceTiming(dir, { version: 1, voices: { voice: { source, segments: [{ text: '你好世界', start: 0, end: 2 }] } } }, { confirmation: '重新确认句段' });
  assert.equal(voiceReviewStatus(dir).ready, false);
  applyVoiceAlignment(dir);
  assert.equal(voiceReviewStatus(dir).ready, true);
  assert.equal(voiceReviewStatus(dir).approved, false);
});

test('无人声且没有旧定位时应用不写工程或创建定位账本', t => {
  const { dir, film, save } = fixture(t);
  save({ ...film, audio: { voice_source: 'none', voices: [] } });
  const file = path.join(dir, 'film.json'), before = fs.readFileSync(file);
  assert.equal(applyVoiceAlignment(dir).applied, true);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.existsSync(path.join(dir, '.wka/voice-alignment.json')), false);
});

test('自动匹配句段不能代替人工试听确认', t => {
  const { dir } = fixture(t); align(dir);
  const file = path.join(dir, '.wka/voice-alignment.json');
  const data = JSON.parse(fs.readFileSync(file));
  fs.writeFileSync(file, JSON.stringify({ ...data, voices: { ...data.voices, voice: { ...data.voices.voice, status: 'matched' } } }));
  assert.equal(voiceAlignmentStatus(dir).ready, true);
  const review = voiceReviewStatus(dir);
  assert.equal(review.ready, false);
  assert.match(review.issues.join(';'), /人工|确认/);
});

test('人声交付仍校验调用者指定的必需文件', t => {
  const { dir } = fixture(t); align(dir);
  const missing = deliveryReport(dir, { required: ['missing.txt'] });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some(error => error.includes('missing.txt')));
  fs.writeFileSync(path.join(dir, 'extra.txt'), '尚未核实的附加文件');
  assert.equal(deliveryReport(dir, { required: ['extra.txt'] }).ok, false);
  assert.equal(deliveryReport(dir, { required: ['voice.wav'] }).ok, true);
});

test('仅明确无人声可跳过，缺配置、缺录音和矛盾配置均阻塞', t => {
  const { dir, film, save } = fixture(t);
  for (const audio of [{}, { voice_source: 'user', voices: [] }]) {
    save({ ...film, audio });
    assert.equal(nextProductionStep(dir, 3), 4);
    assert.equal(voiceReviewStatus(dir).ready, false);
  }
  save({ ...film, audio: { voice_source: 'none', voices: [] } });
  assert.equal(nextProductionStep(dir, 3), 5);
  assert.equal(voiceReviewStatus(dir).applicable, false);
  save({ ...film, audio: { ...film.audio, voice_source: 'none' } });
  assert.equal(nextProductionStep(dir, 3), 4);
  assert.equal(voiceReviewStatus(dir).ready, false);
});
