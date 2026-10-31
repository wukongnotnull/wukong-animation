import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const plugin = fileURLToPath(new URL('../../plugin/', import.meta.url));
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-extracted-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const copy = path.join(root, 'plugin');
  fs.cpSync(plugin, copy, { recursive: true, filter: file => !['node_modules', '.cache'].includes(path.basename(file)) });
  const engine = path.join(copy, 'engine'), film = path.join(root, 'film');
  for (const dir of ['shots', '.wka', '.cache', 'review']) fs.mkdirSync(path.join(film, dir), { recursive: true });
  fs.writeFileSync(path.join(film, 'shots/s01.js'), 'wk.shot({render(){}});');
  fs.writeFileSync(path.join(film, 'film.json'), JSON.stringify({ title: 'Evidence', style: 'ink-wash', size: [32, 18], fps: 10, seed: 1, shots: [{ id: 's01', file: 'shots/s01.js', duration: 1 }], export: { name: 'out', formats: ['mp4'] } }));
  fs.writeFileSync(path.join(film, '.wka/decisions.json'), JSON.stringify({ version: 1, ...Object.fromEntries(Object.entries({ delivery: 'video', aspects: ['16:9'], subtitles: { mode: 'none', bilingual: false } }).map(([key, value]) => [key, { status: 'confirmed', value, source: 'fixture explicit choice' }])) }));
  const final = await import(pathToFileURL(path.join(engine, 'core/final-delivery.mjs')));
  const output = path.join(film, 'out.mp4');
  const save = () => {
    const generation = final.captureFinalGeneration(film, { slot: '16:9/video/mp4/clean', fontFiles: [path.join(film, 'shots/s01.js')] });
    fs.writeFileSync(output, 'same output bytes');
    return final.recordFinalArtifact(film, { generation, path: output, stage: 'encode:mp4', technical: { status: 'passed', checks: ['fixture'], errors: [] } });
  };
  return { engine, film, final, save };
}

test('moving film loading does not allow old delivery evidence to survive implementation edits', async t => {
  const f = await fixture(t), moved = path.join(f.engine, 'core/film-context.mjs');
  assert.ok(fs.existsSync(moved), 'film loading has not yet been extracted');
  const first = f.save(); assert.equal(f.save().id, first.id, 'unchanged repeated generation keeps its identity');
  const revision = f.final.finalDeliveryReport(f.film).reviewSets[13].deliveryRevision;
  const approval = f.final.prepareFinalApproval(f.film, { id: 'approved', step: 13, revision, source: 'fixture explicit approval', note: 'approved' });
  const state = path.join(f.film, '.wka/state.json');
  fs.writeFileSync(state, JSON.stringify({ flow: 5, history: [{ step: 13, approvalId: 'approved' }] }));
  f.final.commitFinalApproval(f.film, approval);
  assert.equal(f.final.finalDeliveryReport(f.film).items[0].acceptance, 'accepted');
  const ledger = path.join(f.film, '.wka/final-delivery.json'), saved = fs.readFileSync(ledger), history = fs.readFileSync(state);
  fs.appendFileSync(moved, '\n// isolated implementation edit\n');
  const item = f.final.finalDeliveryReport(f.film).items[0];
  assert.equal(item.freshness, 'changed'); assert.notEqual(item.acceptance, 'accepted');
  assert.deepEqual(fs.readFileSync(ledger), saved); assert.deepEqual(fs.readFileSync(state), history);
});

for (const relative of ['core/qc-config.mjs', 'core/qc-source.mjs']) test(`QC and final delivery both invalidate ${relative} changes`, async t => {
  const f = await fixture(t), moved = path.join(f.engine, relative);
  assert.ok(fs.existsSync(moved), 'QC source responsibility has not yet been extracted');
  f.save();
  const { runQc } = await import(pathToFileURL(path.join(f.engine, 'core/qc.mjs')));
  await runQc(f.film, { log() {} }); // A real failed QC observation; no fabricated success or media dependency.
  assert.ok(f.final.finalDeliveryReport(f.film).items[0].technicalEvidence.qc, 'consumer recognizes the producer signature');
  const file = path.join(f.film, '.cache/operations.json'), before = JSON.parse(fs.readFileSync(file));
  const signature = Object.values(before.stages).find(s => s.stage === 'review:qc').signature;
  const ledger = path.join(f.film, '.wka/final-delivery.json'), saved = fs.readFileSync(ledger);
  fs.appendFileSync(moved, '\n// isolated QC implementation edit\n');
  assert.equal(f.final.finalDeliveryReport(f.film).items[0].technicalEvidence.qc, undefined, 'old QC is no longer current');
  assert.deepEqual(fs.readFileSync(ledger), saved);
  await runQc(f.film, { log() {} });
  const after = JSON.parse(fs.readFileSync(file));
  assert.notEqual(Object.values(after.stages).find(s => s.stage === 'review:qc').signature, signature);
  assert.ok(f.final.finalDeliveryReport(f.film).items[0].technicalEvidence.qc, 'fresh QC is recognized again');
});
