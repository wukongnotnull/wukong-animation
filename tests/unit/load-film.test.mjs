import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadFilm, render } from '../../plugin/engine/core/job.mjs';

function fixture(t, style, shots, files = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-load-ids-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const film = { title: 'ids', style, size: [320, 180], fps: 10, seed: 1, variants: { '9:16': {} }, shots };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  if (files) for (const shot of shots) fs.writeFileSync(path.join(dir, shot.file), '');
  return dir;
}

for (const style of ['ink-wash', 'keynote']) {
  test(`${style}: repeated IDs fail for both aspects, even before shot files exist`, (t) => {
    for (const identical of [true, false]) {
      const first = { id: 's01', file: 'first.js', duration: 1 };
      const second = identical ? { ...first } : { id: 's01', file: 'second.js', duration: 2 };
      const dir = fixture(t, style, [first, second]);
      const original = fs.readFileSync(path.join(dir, 'film.json'));
      for (const aspect of [null, '9:16']) {
        assert.throws(() => loadFilm(dir, { aspect }), /镜头.*重复.*s01/);
      }
      for (const file of new Set([first.file, second.file])) fs.unlinkSync(path.join(dir, file));
      for (const aspect of [null, '9:16']) {
        assert.throws(() => loadFilm(dir, { aspect, requireShots: false }), /镜头.*重复.*s01/);
        assert.throws(() => loadFilm(dir, { aspect }), /镜头.*重复.*s01/);
      }
      assert.deepEqual(fs.readFileSync(path.join(dir, 'film.json')), original);
      assert.equal(fs.existsSync(path.join(dir, '.cache')), false);
    }
  });

  test(`${style}: unique IDs keep shot order, timing and variant selection`, (t) => {
    const shots = [{ id: 's02', file: 'second.js', duration: 2 }, { id: 's01', file: 'first.js', duration: 1 }];
    const dir = fixture(t, style, shots);
    fs.writeFileSync(path.join(dir, 'first.9x16.js'), '');
    const main = loadFilm(dir), variant = loadFilm(dir, { aspect: '9:16' });
    assert.deepEqual(main.shots.map(s => [s.id, s.start]), [['s02', 0], ['s01', 2]]);
    assert.equal(main.totalDuration, 3);
    assert.equal(variant.shots[1].path, path.join(dir, 'first.9x16.js'));
    assert.equal(main.shots[1].path, path.join(dir, 'first.js'));
  });
}

test('render rejects repeated IDs before missing files, fonts or cache preparation', async (t) => {
  const dir = fixture(t, 'ink-wash', [
    { id: 's01', file: 'missing-a.js', duration: 1 },
    { id: 's01', file: 'missing-b.js', duration: 2 },
  ], false);
  await assert.rejects(render(dir, { log: () => {} }), /镜头.*重复.*s01/);
  assert.deepEqual(fs.readdirSync(dir), ['film.json']);
});
