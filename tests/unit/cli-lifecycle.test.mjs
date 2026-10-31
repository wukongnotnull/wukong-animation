import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../../plugin/engine/bin/wka.mjs', import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-lifecycle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const film = path.join(root, 'film'), cache = path.join(film, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const lock = path.join(cache, 'operation.lock'), active = path.join(cache, 'active-command.json');
  const run = args => spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, WUKONG_ANIMATION_HOME: path.join(root, 'home'), WKA_NO_FONT_DOWNLOAD: '1' },
  });
  return { root, film, cache, lock, active, run };
}

test('invalid signoff step releases its lock and retains the recovery command', t => {
  const f = fixture(t), args = ['signoff', f.film, 'invalid-step probe', '--step', '999'];
  const result = f.run(args);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '✗ --step 取 1–15\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(f.active)), { argv: args });
  assert.equal(fs.existsSync(f.lock), false, 'controlled validation failure must release its lock');
});

test('an async render rejection releases its lock without changing the error contract', t => {
  const f = fixture(t), args = ['render', f.film];
  const result = f.run(args);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr, `✗ 找不到 ${path.join(f.film, 'film.json')}\n`);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.active)), { argv: args });
  assert.equal(fs.existsSync(f.lock), false);
});

test('a successful command releases its lock and preserves the command record', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.film, 'shots'));
  fs.writeFileSync(path.join(f.film, 'shots/s01.js'), 'wk.shot({render(){}});');
  fs.writeFileSync(path.join(f.film, 'film.json'), JSON.stringify({
    title: 'Lifecycle', style: 'ink-wash', size: [32, 18], fps: 10, seed: 1,
    shots: [{ id: 's01', file: 'shots/s01.js', duration: 1 }], subtitles: { mode: 'none' },
  }));
  const args = ['subtitles', f.film], result = f.run(args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '本片 subtitles.mode 为 none，不出字幕\n');
  assert.equal(result.stderr, '');
  assert.equal(fs.existsSync(f.lock), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.active)), { argv: args });
});

test('a refused lock preserves the other owner and the previous recovery command', t => {
  const f = fixture(t), owner = JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'other-owner' });
  fs.writeFileSync(f.lock, owner);
  fs.writeFileSync(f.active, 'previous command');
  const result = f.run(['signoff', f.film, 'invalid-step probe', '--step', '999']);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr, `✗ 工程正在写入或锁所有者无法核实，请稍后检查：${f.lock}\n`);
  assert.equal(fs.readFileSync(f.lock, 'utf8'), owner);
  assert.equal(fs.readFileSync(f.active, 'utf8'), 'previous command');
});
