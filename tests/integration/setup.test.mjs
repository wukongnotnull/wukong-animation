import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dependencyManifest, dependencyDirectory, verifyInstallation } from '../../plugin/engine/core/dependency-manifest.mjs';
import { treeEvidence } from '../../plugin/engine/core/evidence.mjs';

function fixture(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wka setup CLI 中 '));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const plugin = path.join(tmp, 'plugin'), home = path.join(tmp, 'home'), bin = path.join(tmp, 'bin'), calls = path.join(tmp, 'npm-calls.jsonl');
  // Optional test-only fixture source permits running the same regression against an archived baseline.
  const source = process.env.WKA_SETUP_FIXTURE_SOURCE || path.resolve('plugin');
  fs.cpSync(source, plugin, { recursive: true, filter: file => !['node_modules', '.cache', '.wka', 'review', 'stills', 'generated'].includes(path.basename(file)) && !/\.(mp4|mov|webm)$/.test(file) });
  fs.mkdirSync(bin);
  const shim = `const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2);fs.appendFileSync(process.env.WKA_SETUP_CALLS,JSON.stringify(args)+'\\n');
if(args[0]==='--version'){console.log('10.0.0');process.exit(0);}
if(args[0]!=='ci')process.exit(44);
if(process.env.WKA_SETUP_FAIL)process.exit(7);
const lock=JSON.parse(fs.readFileSync('package-lock.json'));
for(const [name] of Object.entries(lock.packages[''].dependencies)){
 const dir=path.join('node_modules',name);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,version:lock.packages['node_modules/'+name].version,main:'index.js'}));
 fs.writeFileSync(path.join(dir,'index.js'),name==='playwright'?
  "module.exports={chromium:{executablePath:()=>require('node:path').resolve(__dirname,'../../browser-ready')}};":"module.exports={};");
}
fs.writeFileSync('node_modules/playwright/cli.js',"require('node:fs').writeFileSync('browser-ready','ready');");`;
  fs.writeFileSync(path.join(bin, 'npm-shim.cjs'), shim);
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'npm.cmd'), `@"${process.execPath}" "%~dp0npm-shim.cjs" %*\r\n`);
  else fs.writeFileSync(path.join(bin, 'npm'), '#!/usr/bin/env node\n' + shim, { mode: 0o755 });
  const engine = path.join(plugin, 'engine');
  const run = (args, extra = {}) => spawnSync(process.execPath, [path.join(engine, 'bin/wka.mjs'), ...args], {
    cwd: tmp, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, WUKONG_ANIMATION_HOME: home, WKA_SETUP_CALLS: calls, ...extra },
  });
  return { tmp, plugin, home, engine, calls, run };
}

test('installed CLI uses the shipped lock and pinned browser CLI, preserves its source and reuses success', t => {
  const f = fixture(t), before = treeEvidence(f.plugin), input = dependencyManifest(f.engine);
  const result = f.run(['setup']); assert.equal(result.status, 0, result.stdout + result.stderr);
  const target = dependencyDirectory(f.home, input); verifyInstallation(target, input);
  for (const name of ['package.json', 'package-lock.json']) assert.deepEqual(fs.readFileSync(path.join(target, name)), fs.readFileSync(path.join(f.engine, name)));
  const again = f.run(['setup']); assert.equal(again.status, 0, again.stdout + again.stderr);
  const calls = fs.readFileSync(f.calls, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.filter(a => a[0] !== '--version'), [['ci', '--no-audit', '--no-fund']]);
  assert.deepEqual(treeEvidence(f.plugin), before);
});

test('installed CLI fails before writing user data on missing lock, but help/status still work', t => {
  const f = fixture(t); fs.rmSync(path.join(f.engine, 'package-lock.json'));
  const result = f.run(['setup']); assert.equal(result.status, 1); assert.match(result.stderr, /package-lock/);
  assert.equal(fs.existsSync(f.home), false); assert.equal(fs.existsSync(f.calls), false);
  for (const command of ['help', 'status']) assert.equal(f.run([command]).status, 0);
});

test('installed CLI preserves the old dependency root on failed npm ci', t => {
  const f = fixture(t), old = path.join(f.home, 'deps/0.2.0/node_modules'); fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'keep'), 'old');
  const result = f.run(['setup'], { WKA_SETUP_FAIL: '1' }); assert.equal(result.status, 1); assert.match(result.stderr, /npm ci.*7/);
  assert.equal(fs.readFileSync(path.join(old, 'keep'), 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(path.dirname(old)), ['node_modules']);
});
