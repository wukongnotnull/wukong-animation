// film.json 旧字段名兼容：读入时换成新名再做 schema 校验，引擎只认新名。
// voiceover / vo_source 是早期只有画外音时起的名字，现在装的是所有人声。

const AUDIO_RENAMES = { voiceover: 'voices', vo_source: 'voice_source' };

/**
 * @returns {{film: object, renamed: string[]}} 换过名的 film（不改原对象）和换了哪些字段
 */
export function migrateFilm(film) {
  const audio = film.audio;
  const hits = audio ? Object.keys(AUDIO_RENAMES).filter((old) => old in audio) : [];
  if (!hits.length) return { film, renamed: [] };
  const clash = hits.filter((old) => AUDIO_RENAMES[old] in audio);
  if (clash.length) {
    const pairs = clash.map((old) => `audio.${old} 与 audio.${AUDIO_RENAMES[old]}`).join('、');
    throw new Error(`film.json 同时写了旧字段名和新字段名：${pairs}。请只保留新名`);
  }
  const next = Object.fromEntries(Object.entries(audio).map(([k, v]) => [AUDIO_RENAMES[k] || k, v]));
  return {
    film: { ...film, audio: next },
    renamed: hits.map((old) => `audio.${old} → audio.${AUDIO_RENAMES[old]}`),
  };
}
