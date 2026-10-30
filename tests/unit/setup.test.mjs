import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dependencyManifest, dependencyDirectory, verifyInstallation } from '../../plugin/engine/core/dependency-manifest.mjs';

const setupFile = path.resolve('plugin/engine/core/setup.mjs');
async function fixture(t) {
  const api = fs.existsSync(setupFile) ? await import(pathToFileURL(setupFile)) : {};
  assert.equal(typeof api.setupDependencies, 'function', '缺少锁文件安装与成功发布功能');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-setup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const engineRoot = path.join(dir, 'engine'), home = path.join(dir, 'home'); fs.mkdirSync(engineRoot);
  const pkg = { name: 'setup-fixture', version: '0.2.0', dependencies: { playwright: '1.2.3' } };
  const lock = { lockfileVersion: 3, packages: { '': pkg, 'node_modules/playwright': { version: '1.2.3' } } };
  fs.writeFileSync(path.join(engineRoot, 'package.json'), JSON.stringify(pkg));
  fs.writeFileSync(path.join(engineRoot, 'package-lock.json'), JSON.stringify(lock));
  const input = dependencyManifest(engineRoot), target = dependencyDirectory(home, input), calls = [];
  let failure = null, nested = null;
  const run = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (args[0] === '--version') return { status: 0, stdout: '10.0.0\n' };
    if (args[0] === 'ci') {
      assert.deepEqual(args, ['ci', '--no-audit', '--no-fund']);
      for (const file of ['package.json', 'package-lock.json']) assert.deepEqual(fs.readFileSync(path.join(options.cwd, file)), fs.readFileSync(path.join(engineRoot, file)));
      if (nested) nested();
      const base = path.join(options.cwd, 'node_modules/playwright'); fs.mkdirSync(base, { recursive: true });
      fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify({ name: 'playwright', version: '1.2.3' }));
      if (failure === 'npm') return { status: 7 };
      return { status: 0 };
    }
    if (args.includes('install')) {
      assert.equal(command, process.execPath); assert.ok(args[0].endsWith(path.join('node_modules', 'playwright', 'cli.js')));
      if (failure === 'browser') return { status: 9 };
      fs.writeFileSync(path.join(options.cwd, 'browser-ready'), 'yes'); return { status: 0 };
    }
    return { status: fs.existsSync(path.join(options.cwd, 'browser-ready')) ? 0 : 1, stderr: 'browser unavailable' };
  };
  const setup = () => api.setupDependencies({ engineRoot, home, run, log: () => {} });
  return { dir, engineRoot, home, input, target, calls, setup, fail: value => { failure = value; }, duringInstall: fn => { nested = fn; } };
}

test('setup publishes only a complete locked installation and reuses it', async t => {
  const f = await fixture(t), old = path.join(f.home, 'deps/0.2.0/node_modules'); fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'keep'), 'old plugin');
  assert.equal(f.setup().root, f.target); verifyInstallation(f.target, f.input);
  assert.equal(fs.readFileSync(path.join(old, 'keep'), 'utf8'), 'old plugin');
  assert.equal(f.calls.filter(c => c.args[0] === 'ci').length, 1);
  assert.equal(f.setup().reused, true);
  assert.equal(f.calls.filter(c => c.args[0] === 'ci').length, 1);
  assert.equal(fs.readdirSync(path.dirname(f.target)).some(n => n.includes('.install-') || n.endsWith('.lock')), false);
});

test('npm and Chromium failures leave no published or reusable installation; retry succeeds', async t => {
  for (const stage of ['npm', 'browser']) {
    const f = await fixture(t); f.fail(stage);
    assert.throws(f.setup, stage === 'npm' ? /npm ci.*7/ : /Chromium.*9/);
    assert.equal(fs.existsSync(f.target), false);
    assert.equal(fs.readdirSync(path.dirname(f.target)).length, 0);
    f.fail(null); f.setup(); verifyInstallation(f.target, f.input);
  }
});

test('same identity cannot install concurrently and does not remove unknown files', async t => {
  const f = await fixture(t);
  f.duringInstall(() => assert.throws(f.setup, /正在安装/)); f.setup();
  const unknown = `${f.target}.install-unknown`; fs.mkdirSync(unknown); fs.writeFileSync(path.join(unknown, 'keep'), 'mine');
  f.setup(); assert.equal(fs.readFileSync(path.join(unknown, 'keep'), 'utf8'), 'mine');
});

test('a lost browser is repaired without reinstalling packages; failure remains failure', async t => {
  const f = await fixture(t); f.setup(); const receipt = fs.readFileSync(path.join(f.target, 'node_modules/.wka-install.json'));
  fs.rmSync(path.join(f.target, 'browser-ready')); f.fail('browser');
  assert.throws(f.setup, /Chromium/); assert.deepEqual(fs.readFileSync(path.join(f.target, 'node_modules/.wka-install.json')), receipt);
  f.fail(null); f.setup(); assert.equal(f.calls.filter(c => c.args[0] === 'ci').length, 1);
});

test('invalid target is retained until replacement is complete; an unrelated identity is preserved', async t => {
  const f = await fixture(t); fs.mkdirSync(f.target, { recursive: true }); fs.writeFileSync(path.join(f.target, 'keep'), 'incomplete');
  const other = path.join(path.dirname(f.target), 'other-identity'); fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'keep'), 'other');
  f.fail('npm'); assert.throws(f.setup); assert.equal(fs.readFileSync(path.join(f.target, 'keep'), 'utf8'), 'incomplete');
  f.fail(null); f.setup(); verifyInstallation(f.target, f.input);
  assert.equal(fs.readFileSync(path.join(other, 'keep'), 'utf8'), 'other');
  const retained = fs.readdirSync(path.dirname(f.target)).find(n => n.includes('.invalid-'));
  assert.equal(fs.readFileSync(path.join(path.dirname(f.target), retained, 'keep'), 'utf8'), 'incomplete');
});

test('source lock errors fail before spawning or creating a user directory', async t => {
  const f = await fixture(t); fs.rmSync(path.join(f.engineRoot, 'package-lock.json'));
  assert.throws(f.setup, /package-lock/); assert.equal(f.calls.length, 0); assert.equal(fs.existsSync(f.home), false);
});

test('a crashed local installer lock is recoverable, unknown locks are retained', async t => {
  const f = await fixture(t); fs.mkdirSync(path.dirname(f.target), { recursive: true });
  const lock = `${f.target}.lock`;
  fs.writeFileSync(lock, JSON.stringify({ pid: 2147483647, host: os.hostname(), token: 'old-installer' }));
  f.setup(); assert.equal(fs.existsSync(lock), false);
  fs.writeFileSync(lock, 'unreadable owner'); assert.throws(f.setup, /所有者|安装/);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'unreadable owner');
});

test('an ongoing lock recovery cannot be bypassed by a second installer', async t => {
  const f = await fixture(t); fs.mkdirSync(`${f.target}.recover`, { recursive: true });
  assert.throws(f.setup, /恢复|正在/); assert.equal(f.calls.length, 0);
  assert.ok(fs.existsSync(`${f.target}.recover`));
});
