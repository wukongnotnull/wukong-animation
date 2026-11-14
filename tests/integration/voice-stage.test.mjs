import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeProduction, readProgress } from '../../plugin/engine/core/state.mjs';
import { voiceAlignmentStatus, importVoiceTiming, applyVoiceAlignment } from '../../plugin/engine/audio/voice-alignment.mjs';
import { voiceReviewStatus } from '../../plugin/engine/core/voice-review.mjs';
import { initReviewRepo } from '../helpers/review-repo.mjs';

const cli = fileURLToPath(new URL('../../plugin/engine/bin/wka.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const ok = result => assert.equal(result.status, 0, result.stdout + result.stderr);
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-voice-stage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initializeProduction(dir); initReviewRepo(dir);
  ok(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', '-y', path.join(dir, 'voice.wav')], { encoding: 'utf8' }));
  const film = { title: '先人声后分镜', style: 'ink-wash', size: [160, 90], fps: 10, seed: 1, shots: [], audio: { voice_source: 'user', voices: [{ cue: 'voice', file: 'voice.wav', at: 0, text: '你好' }] } };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  fs.writeFileSync(path.join(dir, 'brief.md'), '# 简报\n用户录音');
  fs.writeFileSync(path.join(dir, 'story.md'), '# 剧本\n你好');
  ok(spawnSync('git', ['add', '.'], { cwd: dir, encoding: 'utf8' }));
  ok(spawnSync('git', ['commit', '-qm', 'fixture inputs'], { cwd: dir, encoding: 'utf8' }));
  return dir;
}
function align(dir) {
  const source = voiceAlignmentStatus(dir).voices.voice.source;
  importVoiceTiming(dir, { version: 1, voices: { voice: { source, segments: [{ text: '你好', start: 0, end: source.duration }] } } }, { confirmation: '测试中的明确人工确认' });
  applyVoiceAlignment(dir);
}

test('真实CLI在没有分镜时完成剧本、人声交付和签批并保留原音', t => {
  const dir = fixture(t), recording = fs.readFileSync(path.join(dir, 'voice.wav'));
  ok(run('signoff', dir, '剧本通过', '--step', '3'));
  assert.equal(readProgress(dir).step, 4);
  const missing = run('signoff', dir, '不能提前通过', '--step', '4');
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /定位|句段/);
  align(dir);
  const delivery = run('delivery', dir, '--host', 'generic', '--json'); ok(delivery);
  const report = JSON.parse(delivery.stdout);
  assert.ok(report.items.some(item => item.kind === '人声录音' && item.status === 'current'));
  assert.equal(report.items.every(item => item.openStatus === 'not-tested'), true);
  ok(run('signoff', dir, '人声试听通过', '--step', '4', '--approval-id', 'voice-1'));
  assert.equal(readProgress(dir).step, 5);
  assert.equal(voiceReviewStatus(dir).approved, true);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'voice.wav')), recording);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'review/交付/delivery-manifest.json')));
  assert.equal(manifest.step, 4);
  assert.ok(manifest.generated.some(item => item.path === 'voice.wav'));
  ok(run('signoff', dir, '人声试听通过', '--step', '4', '--approval-id', 'voice-1'));
  assert.equal(readProgress(dir).history.filter(h => h.approvalId === 'voice-1').length, 1);
});

test('未批准的人声阻塞分镜签批，force 不能绕过', t => {
  const dir = fixture(t); align(dir);
  const film = JSON.parse(fs.readFileSync(path.join(dir, 'film.json')));
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify({ ...film, shots: [{ id: 's01', file: 's01.js', duration: 1, size: '全景' }] }));
  fs.writeFileSync(path.join(dir, 'storyboard.md'), '# 分镜稿');
  const result = run('signoff', dir, '分镜通过', '--step', '5', '--force');
  assert.notEqual(result.status, 0); assert.match(result.stderr, /人声.*签批|人声.*过期/);
  assert.equal(readProgress(dir).history.length, 0);
});
