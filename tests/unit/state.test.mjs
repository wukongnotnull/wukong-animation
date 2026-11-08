import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PRODUCTION_STEPS, REVIEW_GATES, LAST_STEP, recordProgress, readProgress, listProductions, migrateProgress } from '../../plugin/engine/core/state.mjs';
import * as stateApi from '../../plugin/engine/core/state.mjs';

test('同一批准重试只提交一次历史与定稿身份，输入变化拒绝',()=>{
  assert.equal(typeof stateApi.commitSignoff,'function');
  const {film}=project();const record={id:'user-turn-1',step:6,note:'明确通过',signature:'current',main:{s01:'hash'}};
  const first=stateApi.commitSignoff(film,record),identity=first.approved.mainId;
  stateApi.commitSignoff(film,record);
  assert.equal(readProgress(film).history.length,1);assert.equal(readProgress(film).approved.mainId,identity);
  assert.throws(()=>stateApi.commitSignoff(film,{...record,signature:'changed'}),/变化|不一致/);
  const note={id:'note-only',note:'补充原结论',signature:'current'};
  stateApi.commitSignoff(film,note);stateApi.commitSignoff(film,note);
  assert.equal(readProgress(film).history.filter(h=>h.approvalId==='note-only').length,1);
  fs.rmSync(path.dirname(path.dirname(film)),{recursive:true,force:true});
});

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-state-'));
  const film = path.join(dir, 'films', '寒江');
  fs.mkdirSync(film, { recursive: true });
  stateApi.initializeProduction(film);
  fs.writeFileSync(path.join(film, 'film.json'), JSON.stringify({ title: '寒江', style: 'ink-wash' }));
  return { dir, film };
}

const stateFile = (film) => path.join(film, '.wka', 'state.json');

/** v0.4.0 及以前写下的进度：没有 flow 字段，终审是第 12 道。 */
function writeFlow1(film, step, history) {
  fs.mkdirSync(path.dirname(stateFile(film)), { recursive: true });
  fs.writeFileSync(stateFile(film), JSON.stringify({ step, history, updated: '2026-10-26T01:03:00.000Z' }));
}

const OLD_HISTORY = [
  { step: 10, label: '小样渲染与技术质检', gate: '⑦小样', note: '小样通过', sha: null, at: '2026-10-25T10:00:00.000Z' },
  { step: 12, label: '终检与交付', gate: '⑧终审', note: '成片 v4 终审通过', sha: 'abc', at: '2026-10-26T01:03:00.000Z' },
];

test('future flows are never reinterpreted or written, including approval retries', t => {
  const { dir, film } = project(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(stateFile(film)), { recursive: true });
  for (const flow of [7, 99]) {
    const st = { flow, step: 60, history: [{ step: 60, label: 'future', approvalId: 'same' }], approved: { mainId: 'keep' }, extra: ['keep'] };
    const before = JSON.stringify(st, null, 3); fs.writeFileSync(stateFile(film), before);
    for (const run of [() => migrateProgress(st), () => readProgress(film), () => recordProgress(film, { step: 1 }),
      () => stateApi.recordApproval(film, { main: {} }), () => stateApi.commitSignoff(film, { id: 'same', step: 1 })]) {
      assert.throws(run, { code: 'WKA_FLOW_TOO_NEW', flow, supportedFlow: 6 });
      assert.equal(JSON.stringify(st, null, 3), before);
      assert.equal(fs.readFileSync(stateFile(film), 'utf8'), before);
    }
  }
});

test('explicit invalid flows and corrupt states fail; only absent state/flow is historical', t => {
  const { dir, film } = project(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(readProgress(film), { flow: 6, step: 0, history: [] });
  assert.equal(fs.existsSync(stateFile(film)), true);
  fs.mkdirSync(path.dirname(stateFile(film)), { recursive: true });
  for (const flow of [null, 0, -1, '5', '6', 1.5, true, [], {}]) {
    const raw = JSON.stringify({ flow, history: [] }); fs.writeFileSync(stateFile(film), raw);
    assert.throws(() => readProgress(film), { code: 'WKA_FLOW_INVALID', stateFile: stateFile(film) });
    assert.equal(fs.readFileSync(stateFile(film), 'utf8'), raw);
  }
  for (const raw of ['{broken', 'null', '[]', '42']) {
    fs.writeFileSync(stateFile(film), raw);
    assert.throws(() => readProgress(film), { code: 'WKA_FLOW_INVALID' });
    assert.equal(fs.readFileSync(stateFile(film), 'utf8'), raw);
  }
  fs.rmSync(stateFile(film)); fs.mkdirSync(stateFile(film));
  assert.throws(() => readProgress(film), { code: 'EISDIR' });
});

test('compatibility inspection is read only for legacy state and mixed lists isolate future films', t => {
  const { dir, film } = project(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeFlow1(film, 12, OLD_HISTORY);
  const before = fs.readFileSync(stateFile(film), 'utf8');
  assert.equal(typeof stateApi.assertCompatibleProgress, 'function');
  stateApi.assertCompatibleProgress(film);
  assert.equal(fs.readFileSync(stateFile(film), 'utf8'), before);
  const future = path.join(dir, 'films', 'future'); fs.mkdirSync(path.join(future, '.wka'), { recursive: true });
  fs.writeFileSync(path.join(future, 'brief.md'), 'future brief');
  const raw = '{ "flow": 7, "history": [{"step": 60}] }'; fs.writeFileSync(stateFile(future), raw);
  const list = listProductions(dir), incompatible = list.find(f => f.name === 'future');
  assert.equal(list.find(f => f.name === '寒江').next, null);
  assert.equal(incompatible.compatible, false);
  assert.equal(incompatible.code, 'WKA_FLOW_TOO_NEW');
  assert.equal(incompatible.readonly, true);
  for (const key of ['next', 'nextLabel', 'step', 'last', 'staleVariants']) assert.equal(key in incompatible, false);
  assert.equal(fs.readFileSync(stateFile(future), 'utf8'), raw);
});
