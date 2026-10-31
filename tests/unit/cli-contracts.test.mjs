import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const engine = fileURLToPath(new URL('../../plugin/engine/', import.meta.url));
const baseline = JSON.parse(fs.readFileSync(new URL('../fixtures/cli-v0.19.4.json', import.meta.url)));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-cli-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, WUKONG_ANIMATION_HOME: path.join(root, 'home'), WKA_NO_FONT_DOWNLOAD: '1' };
  return { root, env };
}

test('the runner is importable without running argv or changing process globals', t => {
  const f = fixture(t), runner = path.join(engine, 'cli/run.mjs');
  assert.ok(fs.existsSync(runner), 'the internal runCli interface is not yet implemented');
  const script = `import assert from 'node:assert/strict';
    process.argv.push('signoff', ${JSON.stringify(f.root)}, 'not approved', '--step', '999');
    process.exitCode = 0;
    const before = {argv: [...process.argv], cwd: process.cwd(), exitCode: process.exitCode};
    const {runCli} = await import(${JSON.stringify(pathToFileURL(runner).href)});
    assert.equal(typeof runCli, 'function');
    assert.deepEqual({argv: [...process.argv], cwd: process.cwd(), exitCode: process.exitCode}, before);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: f.root, env: f.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('consecutive runner calls return independent 1/0/2/0 outcomes with one error', async t => {
  const f = fixture(t), runner = path.join(engine, 'cli/run.mjs');
  assert.ok(fs.existsSync(runner), 'the internal runCli interface is not yet implemented');
  fs.writeFileSync(path.join(f.root, 'film.json'), JSON.stringify({ title: 'Contract', style: 'ink-wash', size: [32, 18], fps: 10, seed: 1, shots: [{ id: 's01', file: 'shots/missing.js', duration: 1 }] }));
  const script = `import assert from 'node:assert/strict';
    const {runCli} = await import(${JSON.stringify(pathToFileURL(runner).href)});
    const before = {argv: [...process.argv], cwd: process.cwd(), exitCode: process.exitCode};
    const out=[], errors=[], io={log:(...args)=>out.push(args.join(' ')),error:(...args)=>errors.push(args.join(' '))};
    assert.equal(await runCli(['signoff',${JSON.stringify(f.root)},'probe','--step','999'],io),1);
    assert.deepEqual(errors,['✗ --step 取 1–15']);
    assert.equal(await runCli(['help'],io),0);
    out.length=0;
    assert.equal(await runCli(['delivery',${JSON.stringify(f.root)},'--json'],io),2);
    assert.equal(JSON.parse(out.join('')).ok,false);
    assert.equal(await runCli(['list','pipelines'],io),0);
    assert.equal(errors.length,1);
    assert.deepEqual({argv: [...process.argv], cwd: process.cwd(), exitCode: process.exitCode},before);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: f.root, env: f.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('all 22 command policies match the independent v0.19.4 contract', async () => {
  const file = path.join(engine, 'cli/commands.mjs');
  assert.ok(fs.existsSync(file), 'the single command catalog is not yet implemented');
  const { commandsFor } = await import(pathToFileURL(file));
  const commands = commandsFor({ pos: [], opt: (_name, fallback = null) => fallback, log() {} });
  assert.deepEqual(Object.entries(commands).map(([command, { preflight, lock, active, run }]) => {
    assert.equal(typeof run, 'function', command);
    return { command, preflight, lock, active };
  }), baseline.policies);
});

test('CLI output, help aliases, usage errors and streams match the frozen baseline', t => {
  const f = fixture(t);
  for (const expected of baseline.cases) {
    const r = spawnSync(process.execPath, [path.join(engine, 'bin/wka.mjs'), ...expected.argv], { cwd: f.root, env: f.env, encoding: 'utf8', timeout: 15000 });
    assert.deepEqual({ status: r.status, stdout: r.stdout, stderr: r.stderr }, { status: expected.status, stdout: expected.stdout, stderr: expected.stderr }, expected.argv.join(' '));
  }
});
