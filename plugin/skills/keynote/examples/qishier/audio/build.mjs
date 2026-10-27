// 《七十二变》声音：音效要稀，只在 s04 第 2 个格子点亮时落一声轻"笃"。
export default async function ({ synth, duration, outDir }) {
  const sfx = synth.buffer(duration);
  synth.knock(sfx, { at: 11 + 0.5 });
  synth.reverb(sfx, { mix: 0.2 });
  return [{ file: synth.writeWav(sfx, `${outDir}/sfx.wav`), start: 0, gain: -6 }];
}
