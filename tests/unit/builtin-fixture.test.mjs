import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeBuiltinFixture } from '../fixtures/performance.mjs';
import { validate } from '../../plugin/engine/core/validate.mjs';

for (const [pipeline, style, extension] of [['browser', 'ink-wash', '.js'], ['remotion', 'keynote', '.tsx']]) {
  test(`${pipeline}: independent fixture works without a source film or network`, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-fixture-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const film = writeBuiltinFixture(dir, pipeline, { audio: false });
    assert.deepEqual(validate('film', film, 'fixture'), []);
    assert.equal(film.style, style);
    assert.equal(film.shots.length, 3);
    assert.deepEqual(Object.keys(film.variants), ['9:16']);
    assert.ok(!film.audio);
    for (const shot of film.shots) {
      assert.equal(path.extname(shot.file), extension);
      assert.ok(fs.readFileSync(path.join(dir, shot.file), 'utf8').includes('#fafafa'));
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'film.json'))), film);
  });
}

test('benchmark fixture supplies deterministic local audio', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-fixture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const film = writeBuiltinFixture(dir, 'browser');
  const wav = fs.readFileSync(path.join(dir, film.audio.tracks[0].file));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(40), film.shots.reduce((sum, shot) => sum + shot.duration, 0) * 192000);
});
