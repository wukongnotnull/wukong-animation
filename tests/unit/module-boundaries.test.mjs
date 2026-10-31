import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

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

async function checkFixture(t, sources, files = Object.keys(sources)) {
  const checker = fileURLToPath(new URL('../../tools/check-architecture.mjs', import.meta.url));
  assert.ok(fs.existsSync(checker), 'the AST architecture checker is not yet implemented');
  const { checkArchitecture } = await import(pathToFileURL(checker));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-module-graph-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(sources)) {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
  }
  return checkArchitecture({ root, files });
}

for (const [name, sources, message] of [
  ['static cycle', { 'a.mjs': "import './b.mjs';", 'b.mjs': "import './a.mjs';" }, /cycle: a.mjs -> b.mjs -> a.mjs/],
  ['self cycle', { 'a.mjs': "import './a.mjs';" }, /cycle: a.mjs -> a.mjs/],
  ['re-export cycle', { 'a.mjs': "export * from './b.mjs';", 'b.mjs': "export {x} from './a.mjs';" }, /cycle/],
  ['literal dynamic cycle', { 'a.mjs': "export const load=()=>import('./b.mjs');", 'b.mjs': "import './a.mjs';" }, /cycle/],
  ['core to CLI', { 'core/a.mjs': "import '../cli/a.mjs';", 'cli/a.mjs': '' }, /core.*cli/],
  ['core to bin', { 'core/a.mjs': "export * from '../bin/a.mjs';", 'bin/a.mjs': '' }, /core.*bin/],
  ['transitive input dependency', { 'core/film-context.mjs': "import './middle.mjs';", 'core/middle.mjs': "import './job.mjs';", 'core/job.mjs': '' }, /film-context.*middle.*job/],
  ['missing target', { 'a.mjs': "import './absent.mjs';" }, /missing local target/],
  ['opaque dynamic import', { 'a.mjs': 'export const load=file=>import(file);' }, /unregistered dynamic import/],
  ['new opaque load in allowed file', { 'core/registry.mjs': 'export const another=file=>import(file);' }, /unregistered dynamic import/],
  ['syntax error', { 'a.mjs': 'export const = ;' }, /parse error/],
  ['empty input', {}, /empty module scan/],
  ['handler exits host', { 'cli/commands/a.mjs': 'export const run=()=>process.exit(1);' }, /process.exit/],
  ['import-time command', { 'cli/run.mjs': 'function runCli() {}\nrunCli([]);' }, /import-time command/],
]) test(`architecture rejects ${name}`, async t => {
  const result = await checkFixture(t, sources);
  assert.equal(result.ok, false); assert.match(result.errors.join('\n'), message);
});

test('architecture parses real syntax without treating comments or strings as imports', async t => {
  const result = await checkFixture(t, {
    'a.mjs': `import fs from 'node:fs'; import pkg from 'acorn';
      // import './absent.mjs';
      const prose="export * from './absent.mjs'";
      export {value} from './b.mjs'; export const load=()=>import('./b.mjs');`,
    'b.mjs': 'export const value=1;',
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.graph['a.mjs'], ['b.mjs']);
});

test('only the two registered extension expressions may load opaque modules', async t => {
  const result = await checkFixture(t, {
    'core/registry.mjs': 'export async function loadModule(item) { return import(pathToFileURL(item.entryPath).href); }',
    'audio/soundtrack.mjs': 'async function mixSoundtrackFresh(ctx,audio) { return import(pathToFileURL(path.join(ctx.filmDir, audio.build)).href + `?v=${Date.now()}`); }',
  });
  assert.equal(result.ok, true, result.errors.join('\n')); assert.equal(result.dynamicImports.length, 2);
});

test('a local module cannot silently escape the declared scan', async t => {
  const result = await checkFixture(t, { 'a.mjs': "import './b.mjs';", 'b.mjs': '' }, ['a.mjs']);
  assert.equal(result.ok, false); assert.match(result.errors.join('\n'), /outside module scan/);
});

test('the complete tracked engine obeys the same graph and layer rules', async () => {
  const { checkArchitecture } = await import('../../tools/check-architecture.mjs');
  const result = checkArchitecture();
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.ok(Object.keys(result.graph).length >= 60, 'scan cannot quietly omit the engine');
  assert.equal(result.dynamicImports.length, 2);
});
