import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PRODUCTION_STEPS, REVIEW_GATES, LAST_STEP, recordProgress, listProductions } from '../../plugin/engine/core/state.mjs';

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-state-'));
  const film = path.join(dir, 'films', '寒江');
  fs.mkdirSync(film, { recursive: true });
  fs.writeFileSync(path.join(film, 'film.json'), JSON.stringify({ title: '寒江', style: 'ink-wash' }));
  return { dir, film };
}

test('13 steps with the JianYing draft delivery as the last one', () => {
  assert.equal(LAST_STEP, 13);
  assert.equal(Object.keys(PRODUCTION_STEPS).length, 13);
  assert.equal(PRODUCTION_STEPS[13], '剪映草稿交付');
});

test('9 review gates, ⑨ on step 13', () => {
  assert.equal(Object.keys(REVIEW_GATES).length, 9);
  assert.equal(REVIEW_GATES[12], '⑧终审');
  assert.equal(REVIEW_GATES[13], '⑨剪映草稿');
});

test('a film signed off at the final approval still has the draft delivery ahead', () => {
  const { dir, film } = project();
  recordProgress(film, { step: 12, note: '成片 v1 终审通过' });
  const [f] = listProductions(dir);
  assert.equal(f.next, 13);
  assert.equal(f.nextLabel, '剪映草稿交付');
});

test('a film signed off at step 13 is finished', () => {
  const { dir, film } = project();
  recordProgress(film, { step: 13, note: '剪映草稿已交付' });
  const [f] = listProductions(dir);
  assert.equal(f.next, null);
  assert.equal(f.nextLabel, '已完成');
  assert.equal(f.last.gate, '⑨剪映草稿');
});
