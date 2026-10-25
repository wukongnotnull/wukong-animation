// 《寒江》配乐：稀疏的古琴拨弦（D 商调）+ 极轻的流水，落印一声"笃"（与 s03 的印章同一时刻）。
export default async function ({ synth, duration, outDir }) {
  const buf = synth.buffer(duration);
  synth.water(buf, { from: 0, to: duration, gain: 0.12 });
  synth.qin(buf, { at: 0.6, note: 'D3', dur: 5 });
  synth.qin(buf, { at: 3.2, note: 'A3', dur: 4 });
  synth.qin(buf, { at: 6.0, note: 'G3', dur: 4 });
  synth.knock(buf, { at: 8 + 2.8 });
  synth.reverb(buf, { mix: 0.25 });
  return [{ file: synth.writeWav(buf, `${outDir}/score.wav`), start: 0, gain: 0 }];
}
