import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateFilm } from '../../plugin/engine/core/compat.mjs';

const line = { text: '雾散时', at: 4.5 };

test('renames legacy voiceover and vo_source to voices and voice_source', () => {
  const film = { title: 't', audio: { build: 'audio/build.mjs', vo_source: 'user', voiceover: [line] } };
  const { film: out, renamed } = migrateFilm(film);
  assert.deepEqual(out.audio, { build: 'audio/build.mjs', voice_source: 'user', voices: [line] });
  assert.deepEqual(renamed, ['audio.voiceover → audio.voices', 'audio.vo_source → audio.voice_source']);
});

test('does not mutate the original film', () => {
  const film = { audio: { voiceover: [line] } };
  migrateFilm(film);
  assert.deepEqual(film, { audio: { voiceover: [line] } });
});

test('leaves films already using the new names untouched', () => {
  const film = { audio: { voice_source: 'ai', voices: [line] } };
  const { film: out, renamed } = migrateFilm(film);
  assert.equal(out, film);
  assert.deepEqual(renamed, []);
});

test('leaves films without audio untouched', () => {
  const film = { title: 't' };
  assert.equal(migrateFilm(film).film, film);
});

test('rejects a film that sets both the old and the new name', () => {
  assert.throws(() => migrateFilm({ audio: { voiceover: [line], voices: [line] } }), /voiceover.*voices/s);
  assert.throws(() => migrateFilm({ audio: { vo_source: 'ai', voice_source: 'ai' } }), /vo_source.*voice_source/s);
});

test('loadFilm can skip the shot-file check (for the soundtrack step)', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { loadFilm } = await import('../../plugin/engine/core/job.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-load-'));
  fs.mkdirSync(path.join(dir, 'shots'));
  fs.writeFileSync(path.join(dir, 'shots', 's01.js'), '');
  const shots = ['s01', 's02', 's03'].map((id, i) => ({ id, file: `shots/${id}.js`, duration: i + 1 }));
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify({ title: 't', style: 'ink-wash', size: [320, 180], fps: 10, seed: 1, shots }));
  assert.throws(() => loadFilm(dir), /镜头 s02 的文件不存在/);
  const ctx = loadFilm(dir, { requireShots: false });
  assert.equal(ctx.shots.length, 3);
  assert.equal(ctx.totalDuration, 6);
  assert.equal(ctx.shots[2].start, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});
