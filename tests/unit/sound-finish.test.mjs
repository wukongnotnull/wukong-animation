// 声音收尾：背景音乐 synth.bed、闪避包络、两遍母带、音效听感审计的判定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hasFfmpeg } from '../../plugin/engine/core/ffmpeg.mjs';
import * as synth from '../../plugin/engine/audio/synth.mjs';
import { duckEnvelope, DUCK_DEPTH, DUCK_ATTACK, DUCK_RELEASE } from '../../plugin/engine/audio/duck.mjs';
import { normalizeLoudness } from '../../plugin/engine/audio/loudness.mjs';
import { judgeSfx, formatAudit } from '../../plugin/engine/audio/audit.mjs';

const ffmpeg = { skip: hasFfmpeg() ? false : '需要 ffmpeg' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wka-sound-'));
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const close = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

/** ebur128 复测的整体响度（LUFS）。 */
function lufs(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  return +[...r.stderr.matchAll(/^\s+I:\s+(-?[\d.]+) LUFS/gm)].at(-1)[1];
}

test('synth.bed：只写在 from–to 内，起点淡入，峰值 0.71 × gain，同 seed 结果相同', () => {
  const make = () => {
    const buf = synth.buffer(30);
    synth.bed(buf, { from: 2, to: 28, gain: 0.5 });
    return buf;
  };
  const a = make();
  const sr = a.sr;
  assert.equal(peak(a.L.subarray(0, 2 * sr)), 0);
  assert.equal(peak(a.L.subarray(28 * sr + 1)), 0);
  assert.ok(peak(a.L.subarray(2 * sr, 2 * sr + sr / 20)) < 0.02, '淡入开头应接近 0');
  close(Math.max(peak(a.L), peak(a.R)), 0.71 * 0.5, 0.005, 'peak');
  assert.deepEqual(a.L.subarray(10 * sr, 10 * sr + 100), make().L.subarray(10 * sr, 10 * sr + 100));
  assert.ok(peak(a.L.subarray(14 * sr, 15 * sr)) > 0.05, '中段要有声音');
});

test('闪避包络：说话中 0.48，停顿 1，开口前 0.2 s 下压、说完 0.47 s 回升，重叠取最深', () => {
  const sr = 1000;
  const env = duckEnvelope([[2, 3], [2.5, 4]], 6, sr);
  assert.equal(DUCK_DEPTH, 0.48);
  assert.equal(DUCK_ATTACK, 0.2);
  assert.equal(DUCK_RELEASE, 0.47);
  assert.equal(env.length, 6000);
  assert.equal(env[1000], 1);
  close(env[2000], DUCK_DEPTH, 1e-6, '开口');
  close(env[3500], DUCK_DEPTH, 1e-6, '重叠处');
  close(env[1900], 1 - (1 - DUCK_DEPTH) * 0.5, 1e-3, '下压一半');
  close(env[4000 + 235], 1 - (1 - DUCK_DEPTH) * 0.5, 2e-3, '回升一半');
  assert.equal(env[4500], 1);
  assert.ok(duckEnvelope([], 2, sr).every((v) => v === 1));
});

test('两遍母带：测试音频落在目标 ±0.5 LUFS', ffmpeg, async () => {
  const dir = tmp();
  const buf = synth.buffer(8);
  for (let i = 0; i < buf.L.length; i++) buf.L[i] = buf.R[i] = 0.05 * Math.sin((2 * Math.PI * 440 * i) / buf.sr) * (1 + 0.5 * Math.sin(i / 9000));
  const src = synth.writeWav(buf, path.join(dir, 'in.wav'));
  for (const target of [-14, -18]) {
    const out = path.join(dir, `out${target}.wav`);
    const r = await normalizeLoudness(src, out, target);
    close(lufs(out), target, 0.5, `目标 ${target}`);
    close(r.output, target, 0.5, `回报 ${target}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('两遍母带：静音输入不报错，原样输出', ffmpeg, async () => {
  const dir = tmp();
  const src = synth.writeWav(synth.buffer(2), path.join(dir, 'silent.wav'));
  const out = path.join(dir, 'out.wav');
  const r = await normalizeLoudness(src, out, -14);
  assert.equal(r.output, null);
  assert.ok(fs.existsSync(out));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('审计判定：差值 < -3 dB 记为被盖住，quiet 不报，同帧共用测量', () => {
  const frames = 60;
  const sfxDb = new Array(frames).fill(-120);
  const bedDb = new Array(frames).fill(-20);
  sfxDb.fill(-10, 10, 16); // 第 10 帧起的音效：比人声高 10 dB
  sfxDb.fill(-28, 40, 46); // 第 40 帧起的音效：低 8 dB
  const rows = judgeSfx(
    [{ name: 'ding', at: 10 / 30 }, { name: 'click', at: 10 / 30 }, { name: 'pop', at: 40 / 30 }, { name: 'subtype', at: 40 / 30 }],
    sfxDb, bedDb, { quiet: new Set(['subtype']) },
  );
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  close(by.ding.diff, 10, 1e-6, 'ding');
  assert.equal(by.ding.diff, by.click.diff);
  assert.equal(by.ding.buried, false);
  close(by.pop.diff, -8, 1e-6, 'pop');
  assert.equal(by.pop.buried, true);
  assert.equal(by.subtype.buried, false);
  assert.equal(by.pop.frame, 40);
});

test('审计：音效轨在放置点没有声音（放进了别的文件）时不算被盖住，单独说明', () => {
  const sfxDb = new Array(30).fill(-120);
  const bedDb = new Array(30).fill(-20);
  const rows = judgeSfx([{ name: 'pop', at: 0.2 }], sfxDb, bedDb);
  assert.equal(rows[0].buried, false);
  assert.equal(rows[0].missing, true);
  assert.match(formatAudit(rows).join('\n'), /1 个不在 sfx\.wav 里/);
});

test('审计：placements 按音效轨的 start 换成全片时间', () => {
  const sfxDb = new Array(90).fill(-120);
  const bedDb = new Array(90).fill(-20);
  sfxDb.fill(-10, 60, 66); // 放在音效缓冲 1 s 处、音效轨 start 1 s → 全片 2 s
  const rows = judgeSfx([{ name: 'ding', at: 1 }], sfxDb, bedDb, { offset: 1 });
  assert.equal(rows[0].frame, 60);
  assert.equal(rows[0].at, 2);
  assert.equal(rows[0].buried, false);
});
