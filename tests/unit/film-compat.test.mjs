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
