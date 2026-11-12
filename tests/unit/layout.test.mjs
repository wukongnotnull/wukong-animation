import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviewSection, reviewFile, finalFile, operationsFile, approvedDir, REVIEW_SECTION_NAMES } from '../../plugin/engine/core/layout.mjs';
import { filmUsage, planDeepClean, runDeepClean, formatBytes } from '../../plugin/engine/core/usage.mjs';

test('review reports are sorted into subfolders by name; unknown names stay in the review root', () => {
  const expected = {
    '小样-9x16.mp4': '小样', '局部小样-9x16': '小样', '动态分镜-16x9.mp4': '小样', '接触表-16x9.jpg': '小样',
    'QC报告-9x16-proxy.json': 'QC', '时间轴检查-16x9.md': 'QC', '主版不变报告-9x16.md': 'QC',
    '台词定位.md': '台词', '逐词时间表.md': '台词', '词级同步-16x9.json': '台词',
    '声轨.m4a': '声轨', '声轨审听.json': '声轨', '音效电平审计.md': '声轨', '草稿声音差异-16x9.md': '声轨',
    '素材清单.md': '素材', '交付清单-16x9.json': '交付', '最终交付审计.json': '交付', 'delivery-manifest.json': '交付',
    '环境检查.md': '', '改稿建议.md': '',
  };
  for (const [name, section] of Object.entries(expected)) assert.equal(reviewSection(name), section, name);
  assert.ok(REVIEW_SECTION_NAMES.includes('静帧'));
});

test('reviewFile, finalFile and the .wka helpers resolve under the film directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-layout-'));
  try {
    const report = reviewFile(dir, 'QC报告-9x16.md', { ensure: true });
    assert.equal(report, path.join(dir, 'review', 'QC', 'QC报告-9x16.md'));
    assert.ok(fs.existsSync(path.dirname(report)));
    assert.equal(reviewFile(dir, '环境检查.md'), path.join(dir, 'review', '环境检查.md'));
    assert.equal(finalFile(dir, '春晓-16x9.mp4', { ensure: true }), path.join(dir, '成片', '春晓-16x9.mp4'));
    assert.ok(fs.existsSync(path.join(dir, '成片')));
    assert.equal(operationsFile(dir), path.join(dir, '.wka', 'operations.json'));
    assert.equal(approvedDir(dir), path.join(dir, '.wka', 'approved'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-usage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (rel, content) => { const file = path.join(dir, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; };
  return { dir, put };
}

test('filmUsage lists the standard directories with their sizes', t => {
  const { dir, put } = fixture(t);
  put('.cache/16x9/video.mp4', Buffer.alloc(2048)); put('成片/片-16x9.mp4', Buffer.alloc(1024)); put('media/a.png', Buffer.alloc(512));
  const usage = Object.fromEntries(filmUsage(dir).map(item => [item.name, item.bytes]));
  assert.equal(usage['.cache'], 2048); assert.equal(usage['成片'], 1024); assert.equal(usage.media, 512);
  assert.equal('review' in usage, false);
  assert.equal(formatBytes(3 * 1048576), '3.0 MB');
});

test('deep clean lists cache and regenerable review media, and keeps anything the records point to', t => {
  const { dir, put } = fixture(t);
  put('.cache/16x9/video.mp4', 'v'); put('.cache/mix.wav', 'm'); put('.cache/operation.lock', 'lock'); put('.cache/render-speed.json', '{}');
  put('review/小样/小样-16x9.mp4', 'signed'); put('review/静帧/16x9/s01.png', 'still'); put('review/QC/QC报告-16x9.md', '文字报告');
  put('成片/片-16x9.mp4', 'final'); put('media/素材.png', 'asset'); put('.wka/approved/s01.mp4', 'snapshot');
  const used = 'a'.repeat(64), unused = 'b'.repeat(64);
  put(`.wka/workbench/objects/${used}`, 'x'); put(`.wka/workbench/objects/${unused}`, 'y');
  put('.wka/workbench.json', JSON.stringify({ artifacts: [{ sha256: used }] }));
  put('review/交付/delivery-manifest.json', JSON.stringify({ generated: [{ path: 'review/小样/小样-16x9.mp4' }] }));
  const plan = planDeepClean(dir);
  const names = plan.map(item => path.relative(dir, item.file).split(path.sep).join('/')).sort();
  assert.deepEqual(names, ['.cache/16x9', '.cache/mix.wav', `.wka/workbench/objects/${unused}`, 'review/静帧/16x9/s01.png']);
  assert.equal(runDeepClean(plan), 4);
  for (const kept of ['.cache/operation.lock', '.cache/render-speed.json', 'review/小样/小样-16x9.mp4', 'review/QC/QC报告-16x9.md', '成片/片-16x9.mp4', 'media/素材.png', '.wka/approved/s01.mp4', `.wka/workbench/objects/${used}`]) {
    assert.ok(fs.existsSync(path.join(dir, kept)), kept);
  }
  assert.equal(fs.existsSync(path.join(dir, '.cache/16x9')), false);
});
