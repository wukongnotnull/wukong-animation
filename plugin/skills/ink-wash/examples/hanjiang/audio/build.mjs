// 《寒江》配乐：稀疏的古琴拨弦（D 商调）+ 极轻的流水，落印一声"笃"（与 s03 的印章同一时刻）。
// 配乐、环境声、音效各写一个文件，剪映草稿里各占一条轨；混响是线性的，分开加与合在一起加结果相同。
export default async function ({ synth, duration, outDir }) {
  const bgm = synth.buffer(duration);
  synth.qin(bgm, { at: 0.6, note: 'D3', dur: 5 });
  synth.qin(bgm, { at: 3.2, note: 'A3', dur: 4 });
  synth.qin(bgm, { at: 6.0, note: 'G3', dur: 4 });
  const ambience = synth.buffer(duration);
  synth.water(ambience, { from: 0, to: duration, gain: 0.12 });
  const sfx = synth.buffer(duration);
  synth.knock(sfx, { at: 8 + 2.8 });
  for (const buf of [bgm, ambience, sfx]) synth.reverb(buf, { mix: 0.25 });
  return [
    { file: synth.writeWav(bgm, `${outDir}/bgm.wav`), start: 0, gain: 0 },
    { file: synth.writeWav(ambience, `${outDir}/ambience.wav`), start: 0, gain: 0 },
    { file: synth.writeWav(sfx, `${outDir}/sfx.wav`), start: 0, gain: 0 },
  ];
}
