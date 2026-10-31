import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const engine = fileURLToPath(new URL('../../plugin/engine/', import.meta.url));
const baseline = JSON.parse(fs.readFileSync(new URL('../fixtures/cli-v0.19.4.json', import.meta.url)));

test('the legacy public modules keep their exports after extracting shared inputs', async () => {
  for (const [relative, names] of Object.entries(baseline.exports)) {
    const module = await import(pathToFileURL(path.join(engine, relative)));
    assert.deepEqual(Object.keys(module).sort(), names, relative);
  }
  for (const [oldFile, newFile, names] of [
    ['core/job.mjs', 'core/film-context.mjs', ['loadFilm']],
    ['core/qc.mjs', 'core/qc-config.mjs', ['qcConfig']],
    ['core/delivery.mjs', 'core/delivery-inputs.mjs', ['fileLink', 'readDecisions', 'decisionConflicts']],
    ['bin/args.mjs', 'core/command-args.mjs', ['parseArgs']],
  ]) {
    assert.ok(fs.existsSync(path.join(engine, newFile)), `missing independent input module: ${newFile}`);
    const before = await import(pathToFileURL(path.join(engine, oldFile)));
    const after = await import(pathToFileURL(path.join(engine, newFile)));
    for (const name of names) assert.equal(before[name], after[name], `${oldFile}.${name} must remain the same public operation`);
  }
});
