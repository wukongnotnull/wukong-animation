import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { synthesizeVoiceOver, voFileName, edgeTtsArgs } from '../../plugin/engine/audio/tts.mjs';

/** 假 TTS 引擎：用 ffmpeg 生成一段静音，时长随文本长度变化；记录被调用了几次。 */
function fakeEngine({ failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    name: 'kokoro',
    available: () => true,
    synth: (text, voice, out) => {
      calls.push(text);
      if (text === failOn) {
        fs.writeFileSync(out, 'half-written');
        return false;
      }
      const sec = (0.2 + text.length * 0.05).toFixed(2);
      return spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', sec, out]).status === 0;
    },
  };
}

const quiet = () => {};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wka-vo-'));

test('reuses voice lines whose text and voice have not changed', () => {
  const dir = tmp();
  const lines = [{ text: '孤舟蓑笠翁', at: 0 }, { text: '独钓寒江雪', at: 2 }];
  const e1 = fakeEngine();
  const first = synthesizeVoiceOver(lines, dir, { log: quiet, engines: [e1] });
  assert.equal(e1.calls.length, 2);

  const e2 = fakeEngine();
  const second = synthesizeVoiceOver(lines, dir, { log: quiet, engines: [e2] });
  assert.equal(e2.calls.length, 0, 'second run must not call the TTS engine');
  assert.deepEqual(second.items.map((i) => i.duration), first.items.map((i) => i.duration));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('only re-synthesizes the line that changed and removes the stale file', () => {
  const dir = tmp();
  synthesizeVoiceOver([{ text: '甲', at: 0 }, { text: '乙', at: 1 }], dir, { log: quiet, engines: [fakeEngine()] });
  const e = fakeEngine();
  synthesizeVoiceOver([{ text: '甲', at: 0 }, { text: '丙', at: 1 }], dir, { log: quiet, engines: [e] });
  assert.deepEqual(e.calls, ['丙']);
  assert.deepEqual(fs.readdirSync(dir).sort(), [voFileName('kokoro', undefined, '甲'), voFileName('kokoro', undefined, '丙')].sort());
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a different voice produces a different cache entry', () => {
  assert.notEqual(voFileName('edge-tts', 'zh-CN-YunxiNeural', '句'), voFileName('edge-tts', 'zh-CN-XiaoxiaoNeural', '句'));
});

test('a failed synthesis throws and leaves no partial file behind', () => {
  const dir = tmp();
  assert.throws(() => synthesizeVoiceOver([{ text: '坏', at: 0 }], dir, { log: quiet, engines: [fakeEngine({ failOn: '坏' })] }), /TTS 失败/);
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rate and pitch are part of the cache key; lines without them keep the old key', () => {
  const plain = voFileName('edge-tts', 'zh-CN-YunjianNeural', '句');
  assert.equal(voFileName('edge-tts', 'zh-CN-YunjianNeural', '句', {}), plain);
  const slow = voFileName('edge-tts', 'zh-CN-YunjianNeural', '句', { rate: '-30%' });
  const low = voFileName('edge-tts', 'zh-CN-YunjianNeural', '句', { pitch: '-4Hz' });
  assert.notEqual(slow, plain);
  assert.notEqual(low, plain);
  assert.notEqual(slow, low);
});

test('edge-tts gets --rate= and --pitch= so negative values are not read as flags', () => {
  const args = edgeTtsArgs('句', 'zh-CN-YunjianNeural', '/tmp/a.mp3', { rate: '-30%', pitch: '-4Hz' });
  assert.ok(args.includes('--rate=-30%'));
  assert.ok(args.includes('--pitch=-4Hz'));
  assert.ok(!edgeTtsArgs('句', undefined, '/tmp/a.mp3', {}).some((a) => a.startsWith('--rate') || a.startsWith('--pitch')));
});

test('the engine receives rate and pitch, and changing them re-synthesizes only that line', () => {
  const dir = tmp();
  const seen = [];
  const engine = { ...fakeEngine(), name: 'edge-tts', prosody: true };
  const synth = engine.synth;
  engine.synth = (text, voice, out, o) => (seen.push({ text, ...o }), synth(text, voice, out));
  synthesizeVoiceOver([{ text: '甲', at: 0 }, { text: '乙', at: 1 }], dir, { log: quiet, engines: [engine] });
  seen.length = 0;
  synthesizeVoiceOver([{ text: '甲', at: 0, rate: '-30%', pitch: '-4Hz' }, { text: '乙', at: 1 }], dir, { log: quiet, engines: [engine] });
  assert.deepEqual(seen, [{ text: '甲', rate: '-30%', pitch: '-4Hz' }]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an engine without rate / pitch support warns once and still synthesizes', () => {
  const dir = tmp();
  const logs = [];
  const e = fakeEngine();
  synthesizeVoiceOver([{ text: '甲', at: 0, rate: '-30%' }, { text: '乙', at: 1, pitch: '-2Hz' }], dir, { log: (m) => logs.push(m), engines: [e] });
  assert.equal(e.calls.length, 2);
  assert.equal(logs.filter((m) => /不支持 rate \/ pitch/.test(m)).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
