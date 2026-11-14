import { initializeProduction, commitSignoff } from '../../plugin/engine/core/state.mjs';
import { voiceReviewStatus } from '../../plugin/engine/core/voice-review.mjs';
import { voiceAlignmentStatus, importVoiceTiming, applyVoiceAlignment } from '../../plugin/engine/audio/voice-alignment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as api from '../../plugin/engine/core/workbench.mjs';
import { lockProduction } from '../../plugin/engine/core/operations.mjs';
import { workbenchCatalog, workbenchDependencies } from '../../plugin/engine/core/workbench-catalog.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-review-flow-'));
  initializeProduction(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  put('brief.md', '# 简报\n受众'); put('story.md', '故事');
  const report = () => api.captureWorkbench(dir);
  return { dir, put, report, stage: n => report().stages.find(s => s.step === n) };
}
const check = (dir, item) => api.checkWorkbenchArtifact(dir, { artifactId: item.id, versionId: item.current.id, revision: item.revision });

function voiceFixture(t) {
  const f = fixture(t);
  const film = { audio: { voice_source: 'user', voices: [{ cue: 'v1', file: 'audio/full.wav', at: 0, text: '原稿' }] } };
  f.put('film.json', JSON.stringify(film)); f.put('audio/full.wav', 'full recording');
  f.put('review/台词/台词定位.md', '# 台词定位\n0–1 秒：原稿');
  f.put('review/台词/逐词时间表.md', '# 可选逐词参考');
  const alignment = { version: 1, voices: { v1: { source: { file: 'audio/full.wav', at: 0, text: '原稿' }, segments: [{ text: '原稿', start: 0, end: 1 }], status: 'confirmed', at: 'yesterday' } }, ownedCues: [] };
  f.put('.wka/voice-alignment.json', JSON.stringify(alignment));
  return { ...f, film, alignment };
}

test('voice stage discovers full recordings and formal sentence timing while words stay reference', t => {
  const f = voiceFixture(t), catalog = workbenchCatalog(f.dir);
  const voice = catalog.items.filter(item => item.step === 4);
  assert.deepEqual(voice.filter(item => item.required).map(item => item.relativePath).sort(), ['audio/full.wav', 'review/台词/台词定位.md']);
  assert.equal(voice.find(item => item.relativePath.endsWith('逐词时间表.md'))?.required, false);
  assert.equal(catalog.items.find(item => item.relativePath === 'storyboard.md').step, 5);
});

test('storyboard, preview, main, variant and draft deliverables map to stages five through nine', t => {
  const f = fixture(t);
  const film = { title: '工序映射', style: 'ink-wash', size: [160, 90], fps: 10, seed: 1, shots: [{ id: 's01', file: 's01.js', duration: 1 }], audio: { voice_source: 'none' }, variants: { '9:16': {} } };
  f.put('film.json', JSON.stringify(film));
  f.put('.wka/decisions.json', JSON.stringify({ version: 1, delivery: { status: 'confirmed', value: 'video-and-draft', source: '用户选择' }, aspects: { status: 'confirmed', value: ['16:9', '9:16'], source: '用户选择' } }));
  f.put('.wka/final-delivery.json', JSON.stringify({ artifacts: [{ slot: '16:9/draft/jianying', path: path.join(f.dir, 'draft') }] }));
  const catalog = workbenchCatalog(f.dir), item = label => catalog.items.find(i => i.label === label);
  assert.deepEqual(catalog.warnings, []);
  assert.equal(item('分镜稿').step, 5); assert.equal(item('小样视频').step, 6);
  assert.equal(item('成片视频').step, 7); assert.equal(item('竖屏成片').step, 8); assert.equal(item('剪映草稿').step, 9);
  assert.equal(catalog.notApplicable.has(8), false); assert.equal(catalog.notApplicable.has(9), false);
});

test('only explicitly absent voice is not applicable; unknown and missing recordings block', t => {
  const f = fixture(t);
  assert.notEqual(f.stage(4).status, 'not-applicable');
  f.put('film.json', JSON.stringify({ audio: { voice_source: 'none', voices: [] } }));
  assert.equal(f.stage(4).status, 'not-applicable');
  f.put('film.json', JSON.stringify({ audio: { voice_source: 'user', voices: [{ file: 'missing.wav', at: 0 }] } }));
  assert.ok(f.stage(4).blocks.some(block => /录音|missing.wav/.test(block)));
});

test('voice dependencies ignore placement, picture, music and generated alignment timestamps', t => {
  const f = voiceFixture(t), item = { step: 4, path: path.join(f.dir, 'review/台词/台词定位.md') };
  const initial = workbenchDependencies(f.dir, item, f.film);
  const moved = { ...f.film, shots: [{ id: 's1', duration: 99 }], audio: { ...f.film.audio, build: 'mix.mjs', tracks: [{ file: 'music.wav' }], voices: f.film.audio.voices.map(v => ({ ...v, at: 8 })) } };
  f.put('storyboard.md', '分镜变更'); f.put('music.wav', 'music'); f.put('mix.mjs', 'mix');
  f.put('.wka/voice-alignment.json', JSON.stringify({ ...f.alignment, voices: { v1: { ...f.alignment.voices.v1, at: 'today', source: { ...f.alignment.voices.v1.source, at: 8 } } }, ownedCues: ['speech:v1:1'] }));
  assert.equal(workbenchDependencies(f.dir, item, moved), initial);
  f.put('.wka/voice-alignment.json', JSON.stringify({ ...f.alignment, voices: { v1: { ...f.alignment.voices.v1, segments: [{ text: '原稿', start: 0.1, end: 1 }] } } }));
  assert.notEqual(workbenchDependencies(f.dir, item, moved), initial);
});

test('storyboard review expires when voice placement or recording changes', t => {
  const f = voiceFixture(t);
  f.put('storyboard.md', '已按录音安排分镜');
  const item = f.stage(5).items.find(i => i.relativePath === 'storyboard.md');
  check(f.dir, item);
  const moved = { ...f.film, audio: { ...f.film.audio, voices: f.film.audio.voices.map(v => ({ ...v, at: 3 })) } };
  f.put('film.json', JSON.stringify(moved));
  assert.equal(f.stage(5).items.find(i => i.id === item.id).freshness, 'needs-review');
  f.put('film.json', JSON.stringify(f.film));
  f.put('audio/full.wav', 'replacement recording');
  assert.equal(f.stage(5).items.find(i => i.id === item.id).freshness, 'needs-review');
});

test('voice dependencies invalidate on manuscript and full recording content changes', t => {
  const f = voiceFixture(t), item = { step: 4, path: path.join(f.dir, 'review/台词/台词定位.md') };
  const initial = workbenchDependencies(f.dir, item, f.film);
  f.put('audio/full.wav', 'new full recording');
  assert.notEqual(workbenchDependencies(f.dir, item, f.film), initial);
  f.put('audio/full.wav', 'full recording'); f.put('story.md', '新原稿');
  assert.notEqual(workbenchDependencies(f.dir, item, f.film), initial);
});

function readyVoiceFixture(t) {
  const f = fixture(t), samples = 16000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(samples, 24); wav.writeUInt32LE(samples * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  f.put('voice.wav', wav);
  f.put('film.json', JSON.stringify({ title: '人声审阅', style: 'ink-wash', size: [160, 90], fps: 10, seed: 1, shots: [], audio: { voice_source: 'user', voices: [{ cue: 'v1', file: 'voice.wav', text: '原稿', at: 0 }] } }));
  const source = voiceAlignmentStatus(f.dir).voices.v1.source;
  importVoiceTiming(f.dir, { version: 1, voices: { v1: { source, segments: [{ text: '原稿', start: 0, end: 1 }] } } }, { confirmation: '已听审完整原声' });
  applyVoiceAlignment(f.dir);
  f.put('review/交付/delivery-manifest.json', JSON.stringify({ version: 1, step: 4, tracked: [], generated: [] }));
  const stage = f.stage(4);
  for (const item of stage.items.filter(i => i.required)) check(f.dir, item);
  const approve = () => api.decideWorkbenchStage(f.dir, { step: 4, revision: f.stage(4).revision, decision: 'approved', note: '完整录音与本地定位通过' }, async ({ id, step, note }) => {
    const signature = voiceReviewStatus(f.dir).signature;
    commitSignoff(f.dir, { id, step, note, signature, voice: { signature } });
    return { git: 'committed' };
  });
  return { ...f, approve };
}

test('approved voice survives whole-recording placement and unrelated later delivery changes', async t => {
  const f = readyVoiceFixture(t);
  assert.deepEqual(f.stage(4).blocks, []); await f.approve();
  const approved = f.stage(4); assert.equal(approved.status, 'approved');
  const film = JSON.parse(fs.readFileSync(path.join(f.dir, 'film.json')));
  f.put('film.json', JSON.stringify({ ...film, shots: [{ id: 's01', file: 'missing.js', duration: 30 }], audio: { ...film.audio, voices: film.audio.voices.map(v => ({ ...v, at: 8 })) } }));
  f.put('storyboard.md', '后续分镜');
  f.put('review/交付/delivery-manifest.json', JSON.stringify({ version: 1, step: 7, tracked: [], generated: [{ path: 'exports/later.mp4', bytes: 1, sha256: 'old' }] }));
  const moved = f.stage(4);
  assert.equal(moved.reviewCommit.ready, false);
  assert.deepEqual(moved.items.map(i => [i.relativePath, i.revision, i.dependencies]), approved.items.map(i => [i.relativePath, i.revision, i.dependencies]));
  assert.equal(moved.revision, approved.revision); assert.equal(moved.status, 'approved');
  applyVoiceAlignment(f.dir);
  assert.equal(f.stage(4).revision, approved.revision); assert.equal(f.stage(4).status, 'approved');
});

test('approved voice needs review after sentence-local timing, recording bytes or manuscript changes', async t => {
  for (const change of ['timing', 'recording', 'manuscript']) {
    const f = readyVoiceFixture(t); await f.approve();
    const approved = f.stage(4);
    if (change === 'timing') {
      const alignment = JSON.parse(fs.readFileSync(path.join(f.dir, '.wka/voice-alignment.json')));
      f.put('.wka/voice-alignment.json', JSON.stringify({ ...alignment, voices: { ...alignment.voices, v1: { ...alignment.voices.v1, segments: [{ text: '原稿', start: 0.1, end: 1 }] } } }));
    } else if (change === 'recording') {
      const wav = Buffer.from(fs.readFileSync(path.join(f.dir, 'voice.wav'))); wav.writeInt16LE(1, 44); f.put('voice.wav', wav);
    } else f.put('story.md', '已修改原稿');
    const changed = f.stage(4);
    assert.notEqual(changed.revision, approved.revision, change); assert.equal(changed.status, 'needs-review', change);
  }
});

test('explicit no-voice choice removes an old voice approval from active review', async t => {
  const f = readyVoiceFixture(t); await f.approve();
  const film = JSON.parse(fs.readFileSync(path.join(f.dir, 'film.json')));
  f.put('film.json', JSON.stringify({ ...film, audio: { voice_source: 'none', voices: [] } }));
  assert.equal(f.stage(4).status, 'not-applicable');
});

test('voice approval requires persisted source-bound approval, not history or callback success alone', async t => {
  const f = readyVoiceFixture(t);
  const state = JSON.parse(fs.readFileSync(path.join(f.dir, '.wka/state.json')));
  f.put('.wka/state.json', JSON.stringify({ ...state, history: [{ step: 4, decision: 'approved' }] }));
  assert.equal(f.stage(4).status, 'needs-review');
  const request = { step: 4, revision: f.stage(4).revision, decision: 'approved', note: '听审通过' };
  await assert.rejects(api.decideWorkbenchStage(f.dir, request, async () => ({ git: 'committed' })), /人声签批未保存/);
  assert.equal(f.stage(4).decisions.length, 0);
});

test('explicit recheck accepts the new dependency context without rewriting historical provenance', t => {
  const f = fixture(t), old = f.stage(3).items[0];
  f.put('brief.md', '新的受众');
  let item = f.stage(3).items[0]; assert.equal(item.freshness, 'needs-review');
  check(f.dir, item); item = f.stage(3).items[0];
  assert.equal(item.freshness, 'current'); assert.equal(item.checked, true);
  assert.equal(item.current.dependencies, old.current.dependencies);
  f.put('brief.md', '再次变化'); assert.equal(f.stage(3).items[0].freshness, 'needs-review');
});

test('unknown scans are references; removed files keep a navigable history in their stage', t => {
  const f = fixture(t); f.put('review/reference.txt', '仅参考');
  let item = f.stage(6).items.find(i => i.path.endsWith('reference.txt'));
  assert.equal(item.required, false); assert.equal(item.category, 'reference');
  const note = api.addWorkbenchNote(f.dir, { artifactId: item.id, versionId: item.current.id, text: '参考建议' });
  fs.rmSync(path.join(f.dir, 'review/reference.txt'));
  item = f.stage(6).items.find(i => i.id === item.id);
  assert.ok(item, '已移除文件必须能在原阶段访问'); assert.equal(item.availability, 'historical');
  assert.equal(item.notes[0].id, note.id); assert.equal(fs.readFileSync(api.workbenchFile(f.dir, item.id, item.current.id).file, 'utf8'), '仅参考');
});

test('each media version stores its own shot context and does not invent it for legacy versions', t => {
  const f = fixture(t), film = { title: '结构', shots: [{ id: 's01', duration: 2 }, { id: 's02', duration: 3 }] };
  f.put('film.json', JSON.stringify(film)); f.put('review/小样.mp4', 'immutable media fixture; no encoding');
  const old = f.stage(6).items.find(i => i.path.endsWith('小样.mp4')).current;
  assert.deepEqual(old.context.shots.map(s => [s.id, s.start, s.duration]), [['s01', 0, 2], ['s02', 2, 3]]);
  film.shots.reverse(); f.put('film.json', JSON.stringify(film)); f.put('review/小样.mp4', 'second media fixture');
  let item = f.stage(6).items.find(i => i.path.endsWith('小样.mp4'));
  assert.equal(item.current.context.shots[0].id, 's02'); assert.equal(item.versions[0].context.shots[0].id, 's01');
  const file = path.join(f.dir, '.wka/workbench.json'), ledger = JSON.parse(fs.readFileSync(file));
  delete ledger.artifacts.find(a => a.id === item.id).versions[0].context; fs.writeFileSync(file, JSON.stringify(ledger));
  item = f.stage(6).items.find(i => i.id === item.id); assert.equal(item.versions[0].context, undefined);
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
    assert.deepEqual(ui.writeWorkbenchUI(f.dir, { key: 'note:film:a:v1', expected: 0, value: { text: '草稿一', anchor: { type: 'general' } } }), first, 'lost response retry returns the same saved revision');
    ui.writeWorkbenchUI(f.dir, { key: 'note:film:a:v2', expected: 0, value: { text: '草稿二' } });
    assert.equal(ui.readWorkbenchUI(f.dir).entries['note:film:a:v1'].value.text, '草稿一');
    assert.throws(() => ui.writeWorkbenchUI(f.dir, { key: 'note:film:a:v1', expected: 0, value: { text: '覆盖' } }), /其他页面|冲突/);
    ui.writeWorkbenchUI(f.dir, { key: 'note:film:a:v1', expected: first.revision, value: null });
    assert.equal(ui.readWorkbenchUI(f.dir).entries['note:film:a:v2'].value.text, '草稿二');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, '.wka/state.json'))).step, 0);
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
  const lock = path.join(f.dir, '.cache/operation.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), token: 'dead-owner' }));
  assert.equal(ui.workbenchStatus(f.dir).busy, false, '锁所有者进程已退出时不应显示制作进行中');
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'live-owner' }));
  assert.equal(ui.workbenchStatus(f.dir).busy, true);
  fs.rmSync(lock);
});

test('report stays viewable during production without writing, and submissions stay locked', async t => {
  const f = fixture(t); const registered = f.report(), file = path.join(f.dir, '.wka/workbench.json'), before = fs.readFileSync(file);
  f.put('shots/s01.js', 'rendering source');
  const release = lockProduction(f.dir);
  try {
    const view = api.captureWorkbench(f.dir);
    assert.equal(view.producing, true); assert.equal(view.stages.length, registered.stages.length);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.throws(() => api.addWorkbenchNote(f.dir, { artifactId: 'x', versionId: 'x', text: '意见', anchor: { type: 'general' }, requestId: "00000000-0000-4000-8000-000000000000" }), /工程正在写入|工程忙/);
  } finally { release(); }
  assert.equal(api.captureWorkbench(f.dir).producing, undefined);
});
