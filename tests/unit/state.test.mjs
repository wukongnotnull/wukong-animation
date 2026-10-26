import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PRODUCTION_STEPS, REVIEW_GATES, LAST_STEP, recordProgress, readProgress, listProductions, migrateProgress } from '../../plugin/engine/core/state.mjs';

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-state-'));
  const film = path.join(dir, 'films', '寒江');
  fs.mkdirSync(film, { recursive: true });
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

test('14 steps: subtitles is step 11, the JianYing draft delivery is the last one', () => {
  assert.equal(LAST_STEP, 14);
  assert.equal(Object.keys(PRODUCTION_STEPS).length, 14);
  assert.equal(PRODUCTION_STEPS[11], '字幕制作');
  assert.equal(PRODUCTION_STEPS[12], '终版渲染与终混');
  assert.equal(PRODUCTION_STEPS[13], '终检与交付');
  assert.equal(PRODUCTION_STEPS[14], '剪映草稿交付');
});

test('10 review gates: ⑧ subtitles, ⑨ final approval, ⑩ JianYing draft', () => {
  assert.equal(Object.keys(REVIEW_GATES).length, 10);
  assert.equal(REVIEW_GATES[10], '⑦小样');
  assert.equal(REVIEW_GATES[11], '⑧字幕');
  assert.equal(REVIEW_GATES[12], undefined);
  assert.equal(REVIEW_GATES[13], '⑨终审');
  assert.equal(REVIEW_GATES[14], '⑩剪映草稿');
});

test('migrateProgress shifts steps from 11 on by one and renames their gates', () => {
  const old = { step: 12, history: OLD_HISTORY };
  const { state, migrated } = migrateProgress(old);
  assert.equal(migrated, true);
  assert.equal(state.flow, 2);
  assert.equal(state.step, 13);
  assert.deepEqual(state.history.map((h) => [h.step, h.label, h.gate]), [
    [10, '小样渲染与技术质检', '⑦小样'],
    [13, '终检与交付', '⑨终审'],
  ]);
  assert.equal(state.history[1].note, '成片 v4 终审通过');
  assert.equal(state.history[1].sha, 'abc');
  assert.equal(old.step, 12, '不改入参');
});

test('migrateProgress keeps steps before 11 and leaves flow 2 alone', () => {
  assert.equal(migrateProgress({ step: 10, history: [] }).state.step, 10);
  const current = { flow: 2, step: 11, history: [] };
  const r = migrateProgress(current);
  assert.equal(r.migrated, false);
  assert.equal(r.state, current);
});

test('readProgress migrates an old file and writes it back', () => {
  const { film } = project();
  writeFlow1(film, 12, OLD_HISTORY);
  assert.equal(readProgress(film).step, 13);
  const saved = JSON.parse(fs.readFileSync(stateFile(film), 'utf8'));
  assert.equal(saved.flow, 2);
  assert.equal(saved.step, 13);
});

test('a new progress file is written as flow 2', () => {
  const { film } = project();
  recordProgress(film, { step: 3, note: '选定水墨' });
  assert.equal(JSON.parse(fs.readFileSync(stateFile(film), 'utf8')).flow, 2);
});

test('listProductions flags a migrated film and points it at the draft delivery', () => {
  const { dir, film } = project();
  writeFlow1(film, 12, OLD_HISTORY);
  const [f] = listProductions(dir);
  assert.equal(f.migrated, true);
  assert.equal(f.step, 13);
  assert.equal(f.next, 14);
  assert.equal(f.nextLabel, '剪映草稿交付');
  const [again] = listProductions(dir);
  assert.equal(again.migrated, false);
});

test('a film signed off at the subtitles gate goes on to the final render', () => {
  const { dir, film } = project();
  recordProgress(film, { step: 11, note: '字幕 v1 签批' });
  const [f] = listProductions(dir);
  assert.equal(f.next, 12);
  assert.equal(f.last.gate, '⑧字幕');
});

test('a film signed off at step 14 is finished', () => {
  const { dir, film } = project();
  recordProgress(film, { step: 14, note: '剪映草稿已交付' });
  const [f] = listProductions(dir);
  assert.equal(f.next, null);
  assert.equal(f.nextLabel, '已完成');
  assert.equal(f.last.gate, '⑩剪映草稿');
});
