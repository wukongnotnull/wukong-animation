// 《七十二变》声音：音效要稀，只在 s04 第 2 个格子点亮时落一声"嘟咚"（提示出现）。
export default async function ({ synth, sfx, duration, outDir }) {
  const buf = synth.buffer(duration);
  sfx.place(buf, 'dudong', { at: 11 + 0.5 });
  return [{ file: synth.writeWav(buf, `${outDir}/sfx.wav`), start: 0, gain: 0 }];
}
