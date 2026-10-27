import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditionVoices, voiceShortName } from '../../plugin/engine/audio/audition.mjs';

const quiet = () => {};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wka-aud-'));

function fakeEdge() {
  const calls = [];
  return {
    calls,
    name: 'edge-tts',
    prosody: true,
    available: () => true,
    synth: (text, voice, out, o) => {
      calls.push({ text, voice, ...o });
      return spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '0.5', out]).status === 0;
    },
  };
}

test('short names drop the zh-CN- prefix and the Neural suffix', () => {
  assert.equal(voiceShortName('zh-CN-YunyangNeural'), 'Yunyang');
  assert.equal(voiceShortName('zh-CN-liaoning-XiaobeiNeural'), 'liaoning-Xiaobei');
});

test('one m4a per voice, numbered, same text, rate and pitch passed through', () => {
  const dir = tmp();
  const e = fakeEdge();
  const files = auditionVoices({ text: '春眠不觉晓', voices: ['zh-CN-YunyangNeural', 'zh-CN-YunjianNeural'], rate: '-20%', outDir: dir, engines: [e], log: quiet });
  assert.deepEqual(files.map((f) => path.basename(f.file)), ['试听-1-Yunyang.m4a', '试听-2-Yunjian.m4a']);
  assert.ok(files.every((f) => path.isAbsolute(f.file) && fs.existsSync(f.file)));
  assert.deepEqual(e.calls.map((c) => [c.text, c.voice, c.rate]), [['春眠不觉晓', 'zh-CN-YunyangNeural', '-20%'], ['春眠不觉晓', 'zh-CN-YunjianNeural', '-20%']]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['试听-1-Yunyang.m4a', '试听-2-Yunjian.m4a']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('old audition files are removed before a new round; other review files stay', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '试听-3-Xiaoxiao.m4a'), 'old');
  fs.writeFileSync(path.join(dir, '小样.mp4'), 'keep');
  auditionVoices({ text: '句', voices: ['zh-CN-YunxiNeural'], outDir: dir, engines: [fakeEdge()], log: quiet });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['小样.mp4', '试听-1-Yunxi.m4a'].sort());
  fs.rmSync(dir, { recursive: true, force: true });
});

test('defaults to three voices', () => {
  const dir = tmp();
  const files = auditionVoices({ text: '句', outDir: dir, engines: [fakeEdge()], log: quiet });
  assert.equal(files.length, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('errors: no text, more than 4 voices, no edge-tts', () => {
  const dir = tmp();
  assert.throws(() => auditionVoices({ text: '', outDir: dir, engines: [fakeEdge()], log: quiet }), /试听文本/);
  assert.throws(() => auditionVoices({ text: '句', voices: ['a', 'b', 'c', 'd', 'e'], outDir: dir, engines: [fakeEdge()], log: quiet }), /最多 4 个/);
  assert.throws(() => auditionVoices({ text: '句', outDir: dir, engines: [], log: quiet }), /edge-tts.*自供录音/);
  fs.rmSync(dir, { recursive: true, force: true });
});
