// 《七十二变》声音：铺底背景音乐（本片无人声，duck 不起作用）；音效要稀，只在 s04 第 2 个格子点亮时落一声"嘟咚"（提示出现）。
export default async function ({ synth, sfx, duration, outDir }) {
  const bgm = synth.buffer(duration);
  synth.bed(bgm);
  const fx = synth.buffer(duration);
  sfx.place(fx, 'dudong', { at: 11 + 0.5 });
  return [
    { file: synth.writeWav(bgm, `${outDir}/bgm.wav`), start: 0, gain: -6, duck: true },
    { file: synth.writeWav(fx, `${outDir}/sfx.wav`), start: 0, gain: 0 },
  ];
}
