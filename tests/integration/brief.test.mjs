// 第 2 道制作简报：wka brief 建占位片目录，签批 ① 制作简报，第 3 道 wka init 在占位目录上补齐工程。只跑 CLI，不渲染。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WKA = path.join(ROOT, 'plugin/engine/bin/wka.mjs');

const wka = (cwd, ...args) => spawnSync(process.execPath, [WKA, ...args], { cwd, encoding: 'utf8' });

function project() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wka-brief-'));
}

test('wka brief creates the placeholder film with brief.md and progress', () => {
  const dir = project();
  const r = wka(dir, 'brief', '寒江');
  assert.equal(r.status, 0, r.stderr);
  const film = path.join(dir, 'films', '寒江');
  assert.match(fs.readFileSync(path.join(film, 'brief.md'), 'utf8'), /《寒江》/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(film, '.wka', 'state.json'), 'utf8')).step, 1);
  assert.equal(fs.existsSync(path.join(film, 'film.json')), false);
});

test('wka brief refuses to overwrite an existing brief.md', () => {
  const dir = project();
  wka(dir, 'brief', '寒江');
  const brief = path.join(dir, 'films', '寒江', 'brief.md');
  fs.writeFileSync(brief, '客户改过的简报\n');
  const r = wka(dir, 'brief', '寒江');
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(brief, 'utf8'), '客户改过的简报\n');
});

test('wka brief without a name prints usage and fails', () => {
  const r = wka(project(), 'brief');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /wka brief <片名>/);
});

test('signing off step 2 records the ① brief gate, and status lists the placeholder film', () => {
  const dir = project();
  wka(dir, 'brief', '寒江');
  const s = wka(dir, 'signoff', 'films/寒江', '简报签批', '--step', '2');
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /审片节点 ①制作简报/);
  const st = wka(dir, 'status');
  assert.match(st.stdout, /寒江/);
  assert.match(st.stdout, /未定/);
  assert.match(st.stdout, /下一步：3\. 美术定调/);
});

test('wka init completes the placeholder film and keeps brief.md', () => {
  const dir = project();
  wka(dir, 'brief', '寒江');
  const brief = path.join(dir, 'films', '寒江', 'brief.md');
  fs.writeFileSync(brief, '签批过的简报\n');
  const r = wka(dir, 'init', '寒江', '--style', 'ink-wash', '--aspect', '9:16');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(brief, 'utf8'), '签批过的简报\n');
  const film = JSON.parse(fs.readFileSync(path.join(dir, 'films', '寒江', 'film.json'), 'utf8'));
  assert.deepEqual(film.size, [1080, 1920]);
});
