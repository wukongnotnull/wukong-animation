import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as api from '../../plugin/engine/core/workbench.mjs';
import { lockProduction } from '../../plugin/engine/core/operations.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-review-flow-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  put('brief.md', '# 简报\n受众'); put('story.md', '故事');
  const report = () => api.captureWorkbench(dir);
  return { dir, put, report, stage: n => report().stages.find(s => s.step === n) };
}
const check = (dir, item) => api.checkWorkbenchArtifact(dir, { artifactId: item.id, versionId: item.current.id, revision: item.revision });

test('explicit recheck accepts the new dependency context without rewriting historical provenance', t => {
  const f = fixture(t), old = f.stage(4).items[0];
  f.put('brief.md', '新的受众');
  let item = f.stage(4).items[0]; assert.equal(item.freshness, 'needs-review');
  check(f.dir, item); item = f.stage(4).items[0];
  assert.equal(item.freshness, 'current'); assert.equal(item.checked, true);
  assert.equal(item.current.dependencies, old.current.dependencies);
  f.put('brief.md', '再次变化'); assert.equal(f.stage(4).items[0].freshness, 'needs-review');
});

test('unknown scans are references; removed files keep a navigable history in their stage', t => {
  const f = fixture(t); f.put('review/reference.txt', '仅参考');
  let item = f.stage(8).items.find(i => i.path.endsWith('reference.txt'));
  assert.equal(item.required, false); assert.equal(item.category, 'reference');
  const note = api.addWorkbenchNote(f.dir, { artifactId: item.id, versionId: item.current.id, text: '参考建议' });
  fs.rmSync(path.join(f.dir, 'review/reference.txt'));
  item = f.stage(8).items.find(i => i.id === item.id);
  assert.ok(item, '已移除文件必须能在原阶段访问'); assert.equal(item.availability, 'historical');
  assert.equal(item.notes[0].id, note.id); assert.equal(fs.readFileSync(api.workbenchFile(f.dir, item.id, item.current.id).file, 'utf8'), '仅参考');
});

test('each media version stores its own shot context and does not invent it for legacy versions', t => {
  const f = fixture(t), film = { title: '结构', shots: [{ id: 's01', duration: 2 }, { id: 's02', duration: 3 }] };
  f.put('film.json', JSON.stringify(film)); f.put('review/小样.mp4', 'immutable media fixture; no encoding');
  const old = f.stage(11).items.find(i => i.path.endsWith('小样.mp4')).current;
  assert.deepEqual(old.context.shots.map(s => [s.id, s.start, s.duration]), [['s01', 0, 2], ['s02', 2, 3]]);
  film.shots.reverse(); f.put('film.json', JSON.stringify(film)); f.put('review/小样.mp4', 'second media fixture');
  let item = f.stage(11).items.find(i => i.path.endsWith('小样.mp4'));
  assert.equal(item.current.context.shots[0].id, 's02'); assert.equal(item.versions[0].context.shots[0].id, 's01');
  const file = path.join(f.dir, '.wka/workbench.json'), ledger = JSON.parse(fs.readFileSync(file));
  delete ledger.artifacts.find(a => a.id === item.id).versions[0].context; fs.writeFileSync(file, JSON.stringify(ledger));
  item = f.stage(11).items.find(i => i.id === item.id); assert.equal(item.versions[0].context, undefined);
});

test('blocking feedback survives replacement and repair awaits explicit current-result verification', t => {
  const f = fixture(t); let item = f.stage(2).items[0];
  const note = api.addWorkbenchNote(f.dir, { artifactId: item.id, versionId: item.current.id, text: '明确受众' });
  f.put('brief.md', '已经明确受众'); item = f.stage(2).items[0]; check(f.dir, item);
  assert.ok(f.stage(2).blocks.some(x => /阻塞/.test(x)), '生成新版不能自动解除旧版意见');
  assert.equal(typeof api.recordWorkbenchRepair, 'function', '缺少返修结果回填');
  const repaired = api.recordWorkbenchRepair(f.dir, { id: note.id, artifactId: item.id, versionId: item.current.id, summary: '补充受众', verification: '核对新文档' });
  assert.equal(repaired.status, 'awaiting-review'); assert.equal(repaired.resolved, false);
  assert.ok(f.stage(2).blocks.some(x => /阻塞/.test(x)));
  assert.throws(() => api.resolveWorkbenchNote(f.dir, { id: note.id, resolved: true }), /返修|复验/);
  api.resolveWorkbenchNote(f.dir, { id: note.id, action: 'verified', repairId: repaired.repair.id });
  assert.equal(api.workbenchPending(f.dir).notes.length, 0);
  const closed = f.stage(2).items[0].notes[0]; assert.equal(closed.status, 'resolved'); assert.equal(closed.history.at(-1).action, 'verified');
});

test('stale repair verification is rejected and rejection/dismissal retain their reasons', t => {
  const f = fixture(t); let item = f.stage(2).items[0];
  const note = api.addWorkbenchNote(f.dir, { artifactId: item.id, versionId: item.current.id, text: '修改' });
  assert.equal(typeof api.recordWorkbenchRepair, 'function');
  f.put('brief.md', '返修一'); item = f.stage(2).items[0];
  let repaired = api.recordWorkbenchRepair(f.dir, { id: note.id, versionId: item.current.id, summary: '改文字', verification: '已核对' });
  f.put('brief.md', '返修二');
  assert.throws(() => api.resolveWorkbenchNote(f.dir, { id: note.id, action: 'verified', repairId: repaired.repair.id }), /变化|新版/);
  api.resolveWorkbenchNote(f.dir, { id: note.id, action: 'reopen', reason: '仍不清楚' });
  assert.equal(api.workbenchPending(f.dir).notes[0].status, 'pending');
  assert.throws(() => api.resolveWorkbenchNote(f.dir, { id: note.id, action: 'dismissed' }), /理由/);
  api.resolveWorkbenchNote(f.dir, { id: note.id, action: 'dismissed', reason: '需求已取消' });
  const closed = f.stage(2).items[0].notes[0]; assert.equal(closed.status, 'dismissed'); assert.equal(closed.history.at(-1).reason, '需求已取消');
});

test('repeating a submitted request is idempotent but conflicting reuse fails', t => {
  const f = fixture(t), item = f.stage(2).items[0];
  const req = { artifactId: item.id, versionId: item.current.id, text: '一次意见', requestId: 'request-123' };
  const first = api.addWorkbenchNote(f.dir, req), second = api.addWorkbenchNote(f.dir, req);
  assert.equal(second.id, first.id); assert.equal(api.workbenchPending(f.dir).notes.length, 1);
  assert.throws(() => api.addWorkbenchNote(f.dir, { ...req, text: '另一意见' }), /重复|请求/);
});

test('local drafts survive reopening independently of production, reject conflicts and protect paths', async t => {
  const f = fixture(t), module = new URL('../../plugin/engine/core/workbench-ui.mjs', import.meta.url);
  assert.ok(fs.existsSync(module), '缺少隔离草稿存储'); const ui = await import(module);
  const release = lockProduction(f.dir);
  try {
    const first = ui.writeWorkbenchUI(f.dir, { key: 'note:film:a:v1', expected: 0, value: { text: '草稿一', anchor: { type: 'general' } } });
    ui.writeWorkbenchUI(f.dir, { key: 'note:film:a:v2', expected: 0, value: { text: '草稿二' } });
    assert.equal(ui.readWorkbenchUI(f.dir).entries['note:film:a:v1'].value.text, '草稿一');
    assert.throws(() => ui.writeWorkbenchUI(f.dir, { key: 'note:film:a:v1', expected: 0, value: { text: '覆盖' } }), /其他页面|冲突/);
    ui.writeWorkbenchUI(f.dir, { key: 'note:film:a:v1', expected: first.revision, value: null });
    assert.equal(ui.readWorkbenchUI(f.dir).entries['note:film:a:v2'].value.text, '草稿二');
    assert.equal(fs.existsSync(path.join(f.dir, '.wka/state.json')), false);
  } finally { release(); }
  assert.throws(() => ui.writeWorkbenchUI(f.dir, { key: '__proto__', expected: 0, value: {} }), /键|格式/);
  fs.rmSync(path.join(f.dir, '.wka/workbench-local'), { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-ui-outside-')); t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(f.dir, '.wka/workbench-local'));
  assert.throws(() => ui.readWorkbenchUI(f.dir), /链接/); assert.deepEqual(fs.readdirSync(outside), []);
});

test('change detection sees source edits without capturing versions or running production', async t => {
  const f = fixture(t), module = new URL('../../plugin/engine/core/workbench-ui.mjs', import.meta.url);
  assert.ok(fs.existsSync(module), '缺少变更状态'); const ui = await import(module);
  f.report(); const file = path.join(f.dir, '.wka/workbench.json'), before = fs.readFileSync(file);
  const first = ui.workbenchStatus(f.dir); f.put('shots/s01.js', 'changed source');
  assert.notEqual(ui.workbenchStatus(f.dir).revision, first.revision);
  assert.deepEqual(fs.readFileSync(file), before);
  const release = lockProduction(f.dir); try { assert.equal(ui.workbenchStatus(f.dir).busy, true); } finally { release(); }
});
