import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { synthesizeVoiceOver, voFileName } from '../../plugin/engine/audio/tts.mjs';

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
