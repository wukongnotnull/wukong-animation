import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const moduleUrl = new URL('../../plugin/engine/core/workbench.mjs', import.meta.url);
async function setup(t) {
  assert.ok(fs.existsSync(moduleUrl), '全流程审阅账本尚未实现');
  const api = await import(moduleUrl), dir = fs.mkdtempSync(path.join(os.tmpdir(), '工作台 test-'));
  initializeProduction(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (name, text) => { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  put('brief.md', '# 简报\n第一版'); put('story.md', '故事第一段');
  return { api, dir, put };
}
const at = (report, step) => report.stages.find(s => s.step === step);

test('all 9 active stages are visible before film.json exists', async t => {
 const {api,dir}=await setup(t);const report=api.captureWorkbench(dir);
 assert.equal(report.stages.length,9);assert.equal(report.stages.filter(s=>s.gate).length,8);
 assert.equal(at(report,2).items[0].availability,'present');assert.equal(at(report,5).items[0].availability,'not-generated');
});

test('overwriting a deliverable preserves immutable bytes and does not duplicate unchanged versions', async t => {
  const { api, dir, put } = await setup(t);
  let item = at(api.captureWorkbench(dir), 2).items[0], first = item.current;
  put('brief.md', '# 简报\n第二版');
  item = at(api.captureWorkbench(dir), 2).items[0];
  assert.equal(item.versions.length, 2); assert.notEqual(first.id, item.current.id);
  assert.equal(fs.readFileSync(api.workbenchFile(dir, item.id, first.id).file, 'utf8'), '# 简报\n第一版');
  assert.equal(at(api.captureWorkbench(dir), 2).items[0].versions.length, 2);
});

test('text, image and time annotations validate anchors and survive reopening', async t => {
  const { api, dir, put } = await setup(t);
  let item = at(api.captureWorkbench(dir), 3).items[0];
  api.addWorkbenchNote(dir, { artifactId: item.id, versionId: item.current.id, text: '改开场', anchor: { type: 'text', start: 0, end: 2, quote: '故事' } });
  assert.throws(() => api.addWorkbenchNote(dir, { artifactId: item.id, versionId: item.current.id, text: '错位', anchor: { type: 'text', start: 0, end: 2, quote: '别的' } }), /选段/);
  put('review/test.png', 'image fixture');
  api.registerWorkbenchArtifact(dir, { file: 'review/test.png', step: 3 });
  item = at(api.captureWorkbench(dir), 3).items.find(i => i.path.endsWith('test.png'));
  api.addWorkbenchNote(dir, { artifactId: item.id, versionId: item.current.id, text: '这里', anchor: { type: 'image', x: 0.5, y: 0.2 } });
  assert.throws(() => api.addWorkbenchNote(dir, { artifactId: item.id, versionId: item.current.id, text: '越界', anchor: { type: 'image', x: 2, y: 0 } }), /位置/);
  put('review/test.mp4', 'video fixture');
  api.registerWorkbenchArtifact(dir, { file: 'review/test.mp4', step: 6 });
  item = at(api.captureWorkbench(dir), 6).items.find(i => i.path.endsWith('test.mp4'));
  api.addWorkbenchNote(dir, { artifactId: item.id, versionId: item.current.id, text: '放慢', anchor: { type: 'time', start: 1, end: 2 } });
  assert.throws(() => api.addWorkbenchNote(dir, { artifactId: item.id, versionId: item.current.id, text: '倒序', anchor: { type: 'time', start: 2, end: 1 } }), /时间/);
  assert.equal(api.workbenchPending(dir).notes.length, 3);
});

test('stage acceptance requires checked files and no open blocking note, and rejects stale pages', async t => {
  const { api, dir, put } = await setup(t);
  put('review/交付/delivery-manifest.json', JSON.stringify({ version: 1, step: 2, tracked: [], generated: [] }));
  let stage = at(api.captureWorkbench(dir), 2), calls = 0;
  const signoff = async () => { calls++; return { git: 'committed' }; };
  const request = () => ({ step: 2, revision: stage.revision, decision: 'approved', note: '通过' });
  await assert.rejects(api.decideWorkbenchStage(dir, request(), signoff), /检查/);
  const item = stage.items[0];
  api.checkWorkbenchArtifact(dir, { artifactId: item.id, versionId: item.current.id, revision: item.revision });
  const comment = api.addWorkbenchNote(dir, { artifactId: item.id, versionId: item.current.id, text: '必须改', blocking: true, anchor: { type: 'general' } });
  stage = at(api.captureWorkbench(dir), 2);
  await assert.rejects(api.decideWorkbenchStage(dir, request(), signoff), /阻塞/);
  api.resolveWorkbenchNote(dir, { id: comment.id, action: 'dismissed', reason: '审阅后确认此项无需修改' });
  stage = at(api.captureWorkbench(dir), 2);
  await api.decideWorkbenchStage(dir, request(), signoff);
  assert.equal(calls, 1); assert.equal(at(api.captureWorkbench(dir), 2).status, 'approved');
  api.addWorkbenchNote(dir, { artifactId: item.id, versionId: item.current.id, text: '批准后新增阻塞', blocking: true, anchor: { type: 'general' } });
  assert.equal(at(api.captureWorkbench(dir), 2).status, 'needs-review');
  put('brief.md', '新简报');
  await assert.rejects(api.decideWorkbenchStage(dir, request(), signoff), /变化/);
  assert.equal(calls, 1); assert.notEqual(at(api.captureWorkbench(dir), 2).status, 'approved');
});

test('changing one local shot leaves unrelated local previews current', async t => {
  const { api, dir, put } = await setup(t);
  put('film.json', JSON.stringify({ title: '局部', style: 'ink-wash', size: [32, 18], fps: 10, seed: 1, shots: [{ id: 's01', file: 'shots/s01.js', duration: 1 }, { id: 's02', file: 'shots/s02.js', duration: 1 }], subtitles: { mode: 'none' } }));
  put('shots/s01.js', 'one'); put('shots/s02.js', 'two');
  put('review/局部小样/s01.mp4', 'first'); put('review/局部小样/s02.mp4', 'second');
  api.captureWorkbench(dir); put('shots/s01.js', 'changed');
  const items = at(api.captureWorkbench(dir), 6).items;
  assert.equal(items.find(i => i.path.endsWith('s01.mp4')).freshness, 'needs-review');
  assert.equal(items.find(i => i.path.endsWith('s02.mp4')).freshness, 'current');
});

test('failed signing never creates a successful workbench decision and releases the lock', async t => {
  const { api, dir, put } = await setup(t);
  put('review/交付/delivery-manifest.json', JSON.stringify({ version: 1, step: 2, tracked: [], generated: [] }));
  const stage = at(api.captureWorkbench(dir), 2), item = stage.items[0];
  api.checkWorkbenchArtifact(dir, { artifactId: item.id, versionId: item.current.id, revision: item.revision });
  await assert.rejects(api.decideWorkbenchStage(dir, { step: 2, revision: stage.revision, decision: 'approved', note: '通过' }, async () => { throw new Error('存档失败'); }), /存档失败/);
  assert.equal(at(api.captureWorkbench(dir), 2).status, 'pending');
  assert.equal(fs.existsSync(path.join(dir, '.cache/operation.lock')), false);
});

test('moving a project preserves local artifact identity, versions and notes', async t => {
  const { api, dir, put } = await setup(t);
  put('review/方案.txt', '方案一');
  api.registerWorkbenchArtifact(dir, { file: 'review/方案.txt', step: 3 });
  const item = at(api.captureWorkbench(dir), 3).items.find(i => i.relativePath === 'review/方案.txt');
  api.addWorkbenchNote(dir, { artifactId: item.id, versionId: item.current.id, text: '移动后仍保留', anchor: { type: 'general' } });
  const moved = dir + '-moved'; fs.renameSync(dir, moved); t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  const next = at(api.captureWorkbench(moved), 3).items.find(i => i.id === item.id);
  assert.equal(next.id, item.id); assert.equal(next.current.id, item.current.id);
  assert.equal(next.notes[0].text, '移动后仍保留');
  assert.equal(next.path, path.join(fs.realpathSync(moved), 'review/方案.txt'));
});

test('upstream changes require dependent review while unrelated artifacts stay current', async t => {
  const { api, dir, put } = await setup(t);
  put('review/a.txt', 'A'); put('review/b.txt', 'B'); put('inputs/a.txt', 'one'); put('inputs/b.txt', 'one');
  api.registerWorkbenchArtifact(dir, { file: 'review/a.txt', step: 3, depends: ['inputs/a.txt'] });
  api.registerWorkbenchArtifact(dir, { file: 'review/b.txt', step: 3, depends: ['inputs/b.txt'] });
  api.captureWorkbench(dir); put('inputs/a.txt', 'two');
  const items = at(api.captureWorkbench(dir), 3).items;
  assert.equal(items.find(i => i.path.endsWith('/a.txt')).freshness, 'needs-review');
  assert.equal(items.find(i => i.path.endsWith('/b.txt')).freshness, 'current');
});

test('changes requested create a readable handoff without calling generation or signoff', async t => {
  const { api, dir } = await setup(t);
  const stage = at(api.captureWorkbench(dir), 2);
  await api.decideWorkbenchStage(dir, { step: 2, revision: stage.revision, decision: 'changes-requested', note: '突出主题' }, () => { throw new Error('不应执行'); });
  assert.equal(api.workbenchPending(dir).decisions[0].note, '突出主题');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.wka/state.json'))).step, 0);
});

test('missing current files preserve history and damaged/newer ledgers are never replaced', async t => {
  const { api, dir, put } = await setup(t);
  api.captureWorkbench(dir); fs.rmSync(path.join(dir, 'brief.md'));
  assert.equal(at(api.captureWorkbench(dir), 2).items[0].availability, 'missing');
  for (const raw of ['{broken', '{"version":999}']) {
    put('.wka/workbench.json', raw);
    assert.throws(() => api.captureWorkbench(dir), /工作台/);
    assert.equal(fs.readFileSync(path.join(dir, '.wka/workbench.json'), 'utf8'), raw);
  }
});

test('symlinked project storage and undeclared external source cannot escape project scope', async t => {
  const { api, dir, put } = await setup(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-')); t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.rmSync(path.join(dir,'.wka'),{recursive:true});fs.symlinkSync(outside, path.join(dir, '.wka'));
  assert.throws(() => api.captureWorkbench(dir), /链接|范围/); assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(path.join(dir, '.wka')); put('.wka/state.json', JSON.stringify({flow:8,step:0,history:[]})); put('brief.md', 'safe');
  fs.symlinkSync(outside, path.join(dir, 'review'));
  assert.throws(() => api.captureWorkbench(dir), /链接|范围/);
});

test('an uncommitted deliverable cannot be approved', async t => {
  const { api, dir } = await setup(t);
  const stage = at(api.captureWorkbench(dir), 2);
  assert.equal(stage.reviewCommit.ready, false);
  await assert.rejects(api.decideWorkbenchStage(dir, { step: 2, revision: stage.revision, decision: 'approved', note: '通过' }, async () => ({})), /未提交/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.wka/state.json'))).step, 0);
});

test('a changed generated byte removes approval for the saved commit', async t => {
  const { api, dir, put } = await setup(t);
  put('review/交付/delivery-manifest.json', JSON.stringify({ version: 1, step: 6, tracked: [], generated: [{ path: 'review/小样.mp4', bytes: 1, sha256: 'a'.repeat(64) }] }));
  put('review/小样.mp4', 'changed');
  const stage = at(api.captureWorkbench(dir), 6);
  assert.equal(stage.reviewCommit.ready, false);
  await assert.rejects(api.decideWorkbenchStage(dir, { step: 6, revision: stage.revision, decision: 'approved', note: '通过' }, async () => ({})), /已变化/);
});

test('unchecked files and blocking notes still prevent approval', async t => {
  const { api, dir, put } = await setup(t);
  put('review/交付/delivery-manifest.json', JSON.stringify({ version: 1, step: 2, tracked: [], generated: [] }));
  const stage = at(api.captureWorkbench(dir), 2);
  await assert.rejects(api.decideWorkbenchStage(dir, { step: 2, revision: stage.revision, decision: 'approved', note: '通过' }, async () => ({})), /检查/);
});

test('the first saved decision wins when the other entry arrives later', async t => {
  const { api, dir } = await setup(t);
  const stage = at(api.captureWorkbench(dir), 2);
  await api.decideWorkbenchStage(dir, { step: 2, revision: stage.revision, decision: 'changes-requested', note: '改开场' }, async () => { throw new Error('不应签批'); });
  await assert.rejects(api.decideWorkbenchStage(dir, { step: 2, revision: stage.revision, decision: 'approved', note: '改为通过' }, async () => ({})), /退回/);
  assert.equal(at(api.captureWorkbench(dir), 2).status, 'changes-requested');
});

test('a historical approval stays approved without a new manifest', async t => {
  const { api, dir } = await setup(t);
  const state = JSON.parse(fs.readFileSync(path.join(dir, '.wka/state.json')));
  state.step = 2; state.history = [{ step: 2, decision: 'approved', note: '原结论' }];
  fs.writeFileSync(path.join(dir, '.wka/state.json'), JSON.stringify(state));
  assert.equal(at(api.captureWorkbench(dir), 2).status, 'approved');
});
