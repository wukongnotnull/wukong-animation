import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as state from '../../plugin/engine/core/state.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-new-flow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'films', '新片');
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir };
}
function write(dir, file, value) {
  const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, typeof value === 'string' ? value : JSON.stringify(value));
}
function contents(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .map(e => [e.name, e.isDirectory() ? contents(path.join(dir, e.name)) : fs.readFileSync(path.join(dir, e.name)).toString('base64')]);
}

test('唯一在用流程有九道工序、八个审片门及独立人声节点', () => {
  assert.equal(state.FLOW, 8);
  assert.equal(state.LAST_STEP, 9);
  assert.deepEqual(Object.values(state.PRODUCTION_STEPS), ['制作准备', '确定方案', '编写剧本', '制作人声', '规划镜头', '制作小样', '制作成片', '调整画幅', '导出剪映草稿']);
  assert.equal(Object.keys(state.REVIEW_GATES).length, 8);
  assert.equal(state.REVIEW_GATES[1], undefined);
  assert.match(state.REVIEW_GATES[4], /人声/);
  assert.match(state.REVIEW_GATES[7], /成片/);
  assert.match(state.REVIEW_GATES[8], /画幅/);
  assert.match(state.REVIEW_GATES[9], /剪映/);
});

test('只有输入素材时可新建，身份在补齐简报与影片文件后保持', t => {
  const { dir } = fixture(t); write(dir, '录音.wav', 'existing input');
  assert.equal(typeof state.initializeProduction, 'function');
  state.initializeProduction(dir);
  write(dir, 'brief.md', '方案简报'); write(dir, 'film.json', { title: '新片' });
  assert.equal(state.inspectProduction(dir).mode, 'active');
  assert.equal(state.readProgress(dir).flow, 8);
  assert.equal(fs.readFileSync(path.join(dir, '录音.wav'), 'utf8'), 'existing input');
  state.recordProgress(dir, { step: 2, note: '方案简报通过' });
  assert.equal(state.readProgress(dir).history[0].label, '确定方案');
  assert.equal(state.readProgress(dir).history[0].gate, state.REVIEW_GATES[2]);
});

test('新项目签批绑定新工序；重复批准幂等，越界不写入', t => {
  const { dir } = fixture(t); state.initializeProduction(dir);
  const approval = { id: 'confirmed-turn', step: 7, note: '成片通过', signature: 'current', main: { s01: 'hash' } };
  state.commitSignoff(dir, approval); const first = contents(dir);
  state.commitSignoff(dir, approval); assert.deepEqual(contents(dir), first);
  assert.equal(state.readProgress(dir).history[0].label, '制作成片');
  assert.throws(() => state.recordProgress(dir, { step: 13 }), /工序/);
  assert.throws(() => state.commitSignoff(dir, { ...approval, id: 'wrong', step: 15 }), /工序/);
  assert.deepEqual(contents(dir), first);
});

test('旧进度读取原样返回，不自动换算；任何进度和签批写入均拒绝', t => {
  const { dir } = fixture(t);
  for (const flow of [undefined, 1, 2, 3, 4, 5, 6, 7]) {
    const value = { ...(flow === undefined ? {} : { flow }), step: 13, history: [{ step: 13, label: '旧终审', note: '原结论' }] };
    write(dir, '.wka/state.json', JSON.stringify(value, null, 3)); const before = contents(dir);
    assert.equal(typeof state.inspectProduction, 'function');
    assert.equal(state.inspectProduction(dir).mode, 'archive');
    assert.deepEqual(state.readProgress(dir), value);
    for (const run of [() => state.initializeProduction(dir), () => state.recordProgress(dir, { step: 1 }),
      () => state.recordApproval(dir, { main: {} }), () => state.commitSignoff(dir, { id: 'new', step: 2 })]) {
      assert.throws(run, { code: 'WKA_LEGACY_READONLY' });
      assert.deepEqual(contents(dir), before);
    }
  }
});

for (const file of ['brief.md', 'film.json', '.wka/workbench.json', '.wka/final-delivery.json', '.wka/pending-approval.json', '.cache/operations.json']) {
  test(`只有 ${file} 的旧项目不能被初始化为新项目`, t => {
    const { dir } = fixture(t); write(dir, file, file.endsWith('.json') ? {} : '历史简报'); const before = contents(dir);
    assert.equal(typeof state.inspectProduction, 'function');
    assert.equal(state.inspectProduction(dir).mode, 'archive');
    assert.throws(() => state.initializeProduction(dir), { code: 'WKA_LEGACY_READONLY' });
    assert.deepEqual(contents(dir), before);
  });
}

test('损坏或未来进度不能重新初始化或被当成历史可写项目', t => {
  const { dir } = fixture(t);
  for (const [raw, code] of [['{broken', 'WKA_FLOW_INVALID'], [JSON.stringify({ flow: 9, history: [] }), 'WKA_FLOW_TOO_NEW'],
    [JSON.stringify({ flow: 8, step: 13, history: [] }), 'WKA_FLOW_INVALID']]) {
    write(dir, '.wka/state.json', raw); const before = contents(dir);
    assert.equal(typeof state.initializeProduction, 'function');
    assert.throws(() => state.initializeProduction(dir), { code });
    assert.deepEqual(contents(dir), before);
  }
});

test('列表同时返回可继续的新项目和只读档案，不把旧编号解释成新步骤', t => {
  const { root, dir } = fixture(t); state.initializeProduction(dir);
  state.recordProgress(dir, { step: 6, note: '完整小样通过' });
  const old = path.join(root, 'films', '旧片'); write(old, '.wka/state.json', { flow: 5, step: 5, history: [{ step: 5, label: '原分镜', note: '历史' }] });
  const before = contents(old), rows = state.listProductions(root);
  const current = rows.find(x => x.name === '新片'), archived = rows.find(x => x.name === '旧片');
  assert.equal(current.next, 7); assert.equal(current.nextLabel, '制作成片');
  assert.equal(archived.readonly, true); assert.equal(archived.next, null);
  assert.equal(archived.last.label, '原分镜'); assert.deepEqual(contents(old), before);
});
