import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { writeWordReview } = await import('../../plugin/engine/core/word-sync.mjs');

function fixture(t) {
  const filmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-word-review-'));
  t.after(() => fs.rmSync(filmDir, { recursive: true, force: true }));
  const point = (id, shot) => ({ key: `word:${id}`, id, shot, valid: true, outputFrame: 5, frame: 5, globalFrame: 5, range: [1, 1.1], method: 'estimated', reason: '估算', text: id, input_sha256: id });
  const job = {
    filmDir, fps: 10, proxy: false, log() {}, film: { audio: { voices: [] } },
    variant: { aspect: '16:9', review: name => name, cacheDir: path.join(filmDir, '.cache') },
    shots: ['s01', 's02', 's03'].map((id, i) => ({ id, frames: 20, startFrame: i * 20, wordPoints: [point(`p${i + 1}`, id)] })),
  };
  const calls = [];
  const renderStills = async (points, dir) => {
    calls.push(points[0]);
    const file = path.join(dir, `${points[0].shot}-${points[0].t.toFixed(2)}s.png`);
    fs.writeFileSync(file, 'png');
    return [file];
  };
  return { job, calls, renderStills, report: stem => path.join(filmDir, 'review', '台词', stem) };
}

test('词级检查帧写入 .cache，未变化的点增量复用，镜头变化只重渲该镜', async t => {
  const f = fixture(t);
  let version = { s01: 'a', s02: 'a', s03: 'a' };
  const shotKey = (_, shot) => version[shot.id];
  await writeWordReview(f.job, { renderStills: f.renderStills, shotKey });
  assert.equal(f.calls.length, 9);
  assert.deepEqual(fs.readdirSync(path.join(f.job.filmDir, 'review', '台词')).sort(), ['词级同步.json', '词级同步.md']);
  const report = JSON.parse(fs.readFileSync(f.report('词级同步.json')));
  assert.ok(report.points.every(p => p.images.every(img => img.startsWith(path.join(f.job.filmDir, '.cache', 'word-review')))));

  f.calls.length = 0;
  await writeWordReview(f.job, { renderStills: f.renderStills, shotKey });
  assert.equal(f.calls.length, 0, '输入未变不应重渲');

  version = { ...version, s02: 'b' };
  await writeWordReview(f.job, { renderStills: f.renderStills, shotKey });
  assert.deepEqual([...new Set(f.calls.map(c => c.shot))], ['s02']);
  assert.equal(fs.readdirSync(path.join(f.job.filmDir, '.cache', 'word-review')).filter(n => n.startsWith('p2-s02-')).length, 3, '旧版本帧被清理');
});

test('指定镜头时只检查这些镜头，且局部报告不覆盖整片报告', async t => {
  const f = fixture(t);
  await writeWordReview(f.job, { renderStills: f.renderStills });
  const full = fs.readFileSync(f.report('词级同步.json'), 'utf8');
  f.calls.length = 0;
  await writeWordReview(f.job, { renderStills: f.renderStills, shots: ['s03'], shotKey: () => 'x' });
  assert.deepEqual([...new Set(f.calls.map(c => c.shot))], ['s03']);
  assert.equal(fs.readFileSync(f.report('词级同步.json'), 'utf8'), full);
  const partial = JSON.parse(fs.readFileSync(f.report('词级同步-局部.json')));
  assert.deepEqual(partial.scope, ['s03']);
  assert.equal(partial.points.length, 1);
});

test('生成过程中不提前改写上一次的词级同步报告', async t => {
  const f = fixture(t);
  await writeWordReview(f.job, { renderStills: f.renderStills });
  const before = fs.readFileSync(f.report('词级同步.json'), 'utf8');
  let seen = null;
  await assert.rejects(writeWordReview(f.job, {
    shotKey: () => 'new',
    renderStills: async () => { seen = fs.readFileSync(f.report('词级同步.json'), 'utf8'); throw new Error('boom'); },
  }), /boom/);
  assert.equal(seen, before);
});
