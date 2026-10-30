import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-deps-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const engine = path.join(dir, 'plugin/engine'), home = path.join(dir, 'home');
  fs.mkdirSync(engine, { recursive: true });
  fs.cpSync('plugin/engine/core', path.join(engine, 'core'), { recursive: true });
  const pkg = { name: 'fixture-engine', version: '0.2.0', type: 'module', dependencies: { alpha: '1.0.0', beta: '2.0.0' } };
  const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: {
    '': pkg, 'node_modules/alpha': { version: '1.0.0' }, 'node_modules/beta': { version: '2.0.0' },
  } };
  fs.writeFileSync(path.join(engine, 'package.json'), JSON.stringify(pkg));
  fs.writeFileSync(path.join(engine, 'package-lock.json'), JSON.stringify(lock));
  const put = (root, name, value, version = pkg.dependencies[name]) => {
    const base = path.join(root, 'node_modules', name); fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }));
    fs.writeFileSync(path.join(base, 'index.js'), `module.exports = ${JSON.stringify(value)};`);
  };
  const load = async () => {
    const old = process.env.WUKONG_ANIMATION_HOME; process.env.WUKONG_ANIMATION_HOME = home;
    try { return await import(pathToFileURL(path.join(engine, 'core/deps.mjs'))); }
    finally { if (old === undefined) delete process.env.WUKONG_ANIMATION_HOME; else process.env.WUKONG_ANIMATION_HOME = old; }
  };
  const manifest = async () => {
    const file = path.join(engine, 'core/dependency-manifest.mjs');
    const api = fs.existsSync(file) ? await import(pathToFileURL(file)) : {};
    assert.equal(typeof api.dependencyManifest, 'function', '缺少按锁文件计算依赖身份的功能');
    return api;
  };
  const install = async root => {
    const api = await manifest(), input = api.dependencyManifest(engine);
    fs.mkdirSync(root, { recursive: true });
    if (root !== engine) for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(engine, name), path.join(root, name));
    for (const name of ['alpha', 'beta']) put(root, name, root);
    api.stampDependencies(root, input, { npmVersion: 'test' });
    return input;
  };
  return { dir, engine, home, pkg, lock, put, load, manifest, install };
}

test('unverified legacy and developer installations cannot supply dependencies', async t => {
  const f = fixture(t);
  const legacy = path.join(f.home, 'deps/0.2.0');
  for (const root of [legacy, f.engine]) for (const name of ['alpha', 'beta']) f.put(root, name, root);
  const deps = await f.load();
  assert.throws(() => deps.requireDep('alpha'), /setup|安装凭据/);
  assert.throws(() => deps.resolveDep('beta'), /setup|安装凭据/);
  assert.equal(deps.hasDep('alpha'), false);
});

test('a parent node_modules directory cannot satisfy a missing installation', async t => {
  const f = fixture(t); f.put(f.dir, 'alpha', 'parent');
  const deps = await f.load();
  assert.throws(() => deps.requireDep('alpha'), /setup|依赖/);
  assert.throws(() => deps.resolveDep('alpha'), /setup|依赖/);
});

test('dependency identity follows both file bytes and runtime, not just engine version', async t => {
  const f = fixture(t), api = await f.manifest();
  const first = api.dependencyManifest(f.engine), original = fs.readFileSync(path.join(f.engine, 'package-lock.json'));
  assert.equal(first.identity, api.dependencyManifest(f.engine).identity);
  fs.appendFileSync(path.join(f.engine, 'package-lock.json'), '\n');
  assert.notEqual(first.identity, api.dependencyManifest(f.engine).identity);
  fs.writeFileSync(path.join(f.engine, 'package-lock.json'), original);
  fs.appendFileSync(path.join(f.engine, 'package.json'), '\n');
  assert.notEqual(first.identity, api.dependencyManifest(f.engine).identity);
  for (const runtime of [{ platform: 'another-os' }, { arch: 'another-arch' }, { nodeVersion: 'v99.0.0' }]) {
    assert.notEqual(first.identity, api.dependencyManifest(f.engine, runtime).identity);
  }
});

test('missing, corrupt, unsupported and mismatched locks fail without rewriting input', async t => {
  const f = fixture(t), api = await f.manifest(), file = path.join(f.engine, 'package-lock.json');
  for (const value of ['{broken', JSON.stringify({ ...f.lock, lockfileVersion: 2 }), JSON.stringify({ ...f.lock, packages: { ...f.lock.packages, '': { ...f.pkg, dependencies: { alpha: '9.0.0' } } } })]) {
    fs.writeFileSync(file, value); assert.throws(() => api.dependencyManifest(f.engine), /lock|锁|一致/);
    assert.equal(fs.readFileSync(file, 'utf8'), value);
  }
  fs.rmSync(file); assert.throws(() => api.dependencyManifest(f.engine), /package-lock/);
});

test('verified developer installation supplies both APIs from one root', async t => {
  const f = fixture(t); await f.install(f.engine);
  const deps = await f.load();
  assert.equal(deps.requireDep('alpha'), f.engine);
  assert.equal(deps.resolveDep('beta'), fs.realpathSync(path.join(f.engine, 'node_modules/beta')));
  assert.equal(deps.dependencyInfo().source, 'development');
});

test('matching managed installation wins; package load errors never fall back', async t => {
  const f = fixture(t), api = await f.manifest(), input = await f.install(f.engine);
  const target = api.dependencyDirectory(f.home, input); await f.install(target);
  fs.writeFileSync(path.join(target, 'node_modules/alpha/index.js'), "throw new Error('fixture load failure');");
  const deps = await f.load();
  assert.equal(deps.resolveDep('beta'), fs.realpathSync(path.join(target, 'node_modules/beta')));
  assert.throws(() => deps.requireDep('alpha'), /fixture load failure/);
  assert.equal(deps.dependencyInfo().source, 'managed');
});

test('incomplete managed installation is not hidden by a complete developer installation', async t => {
  const f = fixture(t), api = await f.manifest(), input = await f.install(f.engine);
  const target = api.dependencyDirectory(f.home, input); fs.mkdirSync(target, { recursive: true });
  const deps = await f.load(); assert.throws(() => deps.requireDep('alpha'), /未完成|凭据|setup/);
});

test('mismatched or missing required package invalidates a completed installation', async t => {
  for (const mode of ['missing', 'version']) {
    const f = fixture(t); await f.install(f.engine);
    if (mode === 'missing') fs.rmSync(path.join(f.engine, 'node_modules/beta'), { recursive: true });
    else f.put(f.engine, 'beta', 'wrong', '9.0.0');
    const deps = await f.load(); assert.throws(() => deps.requireDep('alpha'), /beta.*(版本|缺|ENOENT)|setup/);
  }
});

test('a package outside the chosen root is rejected even after selecting a valid root', async t => {
  const f = fixture(t); await f.install(f.engine); f.put(f.dir, 'outsider', 'parent', '1.0.0');
  const deps = await f.load(); assert.equal(deps.requireDep('alpha'), f.engine);
  assert.throws(() => deps.requireDep('outsider'), /范围|目录|来源/);
  assert.throws(() => deps.resolveDep('outsider'), /范围|目录|来源/);
});
