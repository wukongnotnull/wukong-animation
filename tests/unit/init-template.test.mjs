import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WKA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugin/engine/bin/wka.mjs');
const init = (style) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-init-'));
  const r = spawnSync(process.execPath, [WKA, 'init', 'demo', '--style', style, '--dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return path.join(dir, 'films', 'demo');
};

test('remotion 风格：镜头模板是 s01.tsx，film.json 指向它，不留 s01.js', () => {
  const film = init('keynote');
  assert.deepEqual(fs.readdirSync(path.join(film, 'shots')), ['s01.tsx']);
  const json = JSON.parse(fs.readFileSync(path.join(film, 'film.json'), 'utf8'));
  assert.equal(json.shots[0].file, 'shots/s01.tsx');
  assert.match(fs.readFileSync(path.join(film, 'shots', 's01.tsx'), 'utf8'), /export default function S01/);
});

test('browser 风格不变：仍是 s01.js', () => {
  const film = init('ink-wash');
  assert.deepEqual(fs.readdirSync(path.join(film, 'shots')), ['s01.js']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(film, 'film.json'), 'utf8')).shots[0].file, 'shots/s01.js');
});
