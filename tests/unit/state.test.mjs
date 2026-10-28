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

test('15 steps: subtitles is step 11, the variant step is 14, the JianYing draft delivery is the last one', () => {
  assert.equal(LAST_STEP, 15);
  assert.equal(Object.keys(PRODUCTION_STEPS).length, 15);
  assert.equal(PRODUCTION_STEPS[11], '字幕制作');
  assert.equal(PRODUCTION_STEPS[12], '终版渲染与终混');
  assert.equal(PRODUCTION_STEPS[13], '终检与交付');
  assert.equal(PRODUCTION_STEPS[4], '剧本撰写');
  assert.equal(PRODUCTION_STEPS[14], '改版');
  assert.equal(PRODUCTION_STEPS[15], '剪映草稿交付');
});

test('12 review gates: ① brief, ⑨ subtitles, ⑩ final approval, ⑪ variant, ⑫ JianYing draft', () => {
  assert.equal(Object.keys(REVIEW_GATES).length, 12);
  assert.equal(REVIEW_GATES[1], undefined);
  assert.equal(REVIEW_GATES[2], '①制作简报');
  assert.equal(REVIEW_GATES[3], '②美术定调');
  assert.equal(REVIEW_GATES[4], '③剧本');
  assert.equal(REVIEW_GATES[10], '⑧小样');
  assert.equal(REVIEW_GATES[11], '⑨字幕');
  assert.equal(REVIEW_GATES[12], undefined);
  assert.equal(REVIEW_GATES[13], '⑩终审');
  assert.equal(REVIEW_GATES[14], '⑪改版审片');
  assert.equal(REVIEW_GATES[15], '⑫剪映草稿');
});

test('migrateProgress shifts steps from 11 on by one and renames their gates', () => {
  const old = { step: 12, history: OLD_HISTORY };
  const { state, migrated } = migrateProgress(old);
  assert.equal(migrated, true);
  assert.equal(state.flow, 4);
  assert.equal(state.step, 13);
  assert.deepEqual(state.history.map((h) => [h.step, h.label, h.gate]), [
    [10, '小样渲染与技术质检', '⑧小样'],
    [13, '终检与交付', '⑩终审'],
  ]);
  assert.equal(state.history[1].note, '成片 v4 终审通过');
  assert.equal(state.history[1].sha, 'abc');
  assert.equal(old.step, 12, '不改入参');
});

test('migrateProgress relabels the gates of a flow 2 file without moving steps', () => {
  const flow2 = {
    flow: 2,
    step: 4,
    history: [
      { step: 3, label: '美术定调', gate: '①美术定调', note: '选定水墨', sha: null, at: '2026-10-27T01:00:00.000Z' },
      { step: 4, label: '文学脚本撰写', gate: '②文学脚本', note: 'v2 签批', sha: 'def', at: '2026-10-27T02:00:00.000Z' },
    ],
  };
  const { state, migrated } = migrateProgress(flow2);
  assert.equal(migrated, true);
  assert.equal(state.flow, 4);
  assert.equal(state.step, 4);
  assert.deepEqual(state.history.map((h) => [h.step, h.gate, h.note]), [
    [3, '②美术定调', '选定水墨'],
    [4, '③剧本', 'v2 签批'],
  ]);
  assert.equal(flow2.history[0].gate, '①美术定调', '不改入参');
});

test('migrateProgress keeps steps before 11 and leaves flow 4 alone', () => {
  assert.equal(migrateProgress({ step: 10, history: [] }).state.step, 10);
  const current = { flow: 4, step: 11, history: [] };
  const r = migrateProgress(current);
  assert.equal(r.migrated, false);
  assert.equal(r.state, current);
});

test('readProgress migrates an old file and writes it back', () => {
  const { film } = project();
  writeFlow1(film, 12, OLD_HISTORY);
  assert.equal(readProgress(film).step, 13);
  const saved = JSON.parse(fs.readFileSync(stateFile(film), 'utf8'));
  assert.equal(saved.flow, 4);
  assert.equal(saved.step, 13);
});

test('a new progress file is written as flow 4', () => {
  const { film } = project();
  recordProgress(film, { step: 3, note: '选定水墨' });
  assert.equal(JSON.parse(fs.readFileSync(stateFile(film), 'utf8')).flow, 4);
});

test('listProductions flags a migrated film and points it at the variant step', () => {
  const { dir, film } = project();
  writeFlow1(film, 12, OLD_HISTORY);
  const [f] = listProductions(dir);
  assert.equal(f.migrated, true);
  assert.equal(f.step, 13);
  assert.equal(f.next, 14);
  assert.equal(f.nextLabel, '改版');
  const [again] = listProductions(dir);
  assert.equal(again.migrated, false);
});

test('a film signed off at the subtitles gate goes on to the final render', () => {
  const { dir, film } = project();
  recordProgress(film, { step: 11, note: '字幕 v1 签批' });
  const [f] = listProductions(dir);
  assert.equal(f.next, 12);
  assert.equal(f.last.gate, '⑨字幕');
});

test('a film signed off at step 15 is finished', () => {
  const { dir, film } = project();
  recordProgress(film, { step: 15, note: '剪映草稿已交付' });
  const [f] = listProductions(dir);
  assert.equal(f.next, null);
  assert.equal(f.nextLabel, '已完成');
  assert.equal(f.last.gate, '⑫剪映草稿');
});

test('a placeholder film with only brief.md is listed with its folder name and no style yet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-state-'));
  const film = path.join(dir, 'films', '春晓');
  fs.mkdirSync(film, { recursive: true });
  fs.writeFileSync(path.join(film, 'brief.md'), '# 《春晓》制作简报\n');
  fs.mkdirSync(path.join(dir, 'films', '空目录'));
  recordProgress(film, { step: 2, note: '简报签批' });
  const list = listProductions(dir);
  assert.equal(list.length, 1);
  const [f] = list;
  assert.equal(f.name, '春晓');
  assert.equal(f.title, '春晓');
  assert.equal(f.style, '未定');
  assert.equal(f.next, 3);
  assert.equal(f.last.gate, '①制作简报');
});

test('migrateProgress moves the flow 3 JianYing draft step 14 to 15 and keeps step 13', () => {
  const flow3 = {
    flow: 3,
    step: 14,
    history: [
      { step: 13, label: '终检与交付', gate: '⑩终审', note: '终审通过', sha: 'a', at: '2026-10-28T01:00:00.000Z' },
      { step: 14, label: '剪映草稿交付', gate: '⑪剪映草稿', note: '草稿导出', sha: 'b', at: '2026-10-28T02:00:00.000Z' },
    ],
  };
  const { state, migrated } = migrateProgress(flow3);
  assert.equal(migrated, true);
  assert.equal(state.flow, 4);
  assert.equal(state.step, 15);
  assert.deepEqual(state.history.map((h) => [h.step, h.label, h.gate]), [
    [13, '终检与交付', '⑩终审'],
    [15, '剪映草稿交付', '⑫剪映草稿'],
  ]);
  assert.equal(flow3.step, 14, '不改入参');
});

test('migrateProgress takes a flow 1 file all the way to flow 4', () => {
  // flow 1 的第 13 道是剪映草稿：先挪到 14（flow 2/3），再挪到 15
  const { state } = migrateProgress({ step: 13, history: [{ step: 13, note: '草稿', at: '2026-10-25T00:00:00.000Z' }] });
  assert.equal(state.step, 15);
  assert.equal(state.history[0].gate, '⑫剪映草稿');
});
