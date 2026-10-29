import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrameTimeline } from '../../plugin/engine/core/timing.mjs';

test('累计帧数与所有切点误差有界，包括奇数帧率', () => {
  for (const fps of [12, 15, 24, 25, 29, 30, 60, 120]) {
    const shots = Array.from({ length: 107 }, (_, i) => ({ id: `s${i}`, duration: i % 2 ? 0.73 : 1.02 }));
    const original = JSON.stringify(shots);
    const t = buildFrameTimeline(shots, fps);
    let seconds = 0;
    for (const s of t.shots) {
      seconds += s.plannedDuration;
      assert.equal(s.endFrame, Math.round(seconds * fps));
      assert.ok(Math.abs(s.endFrame / fps - seconds) <= 0.5 / fps + 1e-10);
    }
    assert.equal(t.totalFrames, Math.round(seconds * fps));
    assert.equal(JSON.stringify(shots), original);
  }
});

test('107×1.02s：高清3274帧，小样1637帧', () => {
  const shots = Array.from({ length: 107 }, (_, i) => ({ id: `s${i}`, duration: 1.02 }));
  assert.equal(buildFrameTimeline(shots, 30).totalFrames, 3274);
  assert.equal(buildFrameTimeline(shots, 15).totalFrames, 1637);
});

test('整数帧镜长不变；低帧率零帧拒绝，不静默补帧', () => {
  assert.deepEqual(buildFrameTimeline([{ id: 's01', duration: 1 }, { id: 's02', duration: 2 }], 30).shots.map(s => s.frames), [30, 60]);
  assert.throws(() => buildFrameTimeline([{ id: 's01', duration: 0.1 }], 1), /s01.*0.1s.*1fps/);
  assert.equal(buildFrameTimeline([{ id: 's01', duration: 0.1 }], 30).totalFrames, 3);
  assert.throws(() => buildFrameTimeline([], 29.97), /整数/);
});

test('真实媒体检查拒绝错误帧数，即使容器时长看起来正常', async () => {
  const timing = await import('../../plugin/engine/core/timing.mjs');
  assert.equal(typeof timing.inspectVideo, 'function', '缺少真实媒体检查');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'wka-timing-unit-'));
  try {
    const file = join(dir, 'clip.mp4');
    const r = spawnSync('ffmpeg', ['-v','error','-y','-f','lavfi','-i','color=c=red:s=16x16:r=30','-frames:v','31',file]);
    assert.equal(r.status, 0, String(r.stderr));
    assert.equal(timing.inspectVideo(file, { fps: 30, frames: 31 }).ok, true);
    const bad = timing.inspectVideo(file, { fps: 30, frames: 30 });
    assert.equal(bad.ok, false);
    assert.match(bad.errors.join(' '), /31.*30/);
    assert.equal(timing.inspectVideo(file, { fps: 15, frames: 31 }).ok, false);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});
