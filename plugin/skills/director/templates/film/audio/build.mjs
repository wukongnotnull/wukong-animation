// 配乐 / 音效脚本：用 synth 合成原创声音，返回音轨列表。
// 参数：{ synth, duration, outDir, shots, log }
export default async function ({ synth, duration, outDir }) {
  const buf = synth.buffer(duration);
  // synth.qin(buf, { at: 0.5, note: 'D3', dur: 5 });
  // synth.water(buf, { from: 0, to: duration, gain: 0.2 });
  synth.reverb(buf, { mix: 0.25 });
  return [{ file: synth.writeWav(buf, `${outDir}/score.wav`), start: 0, gain: 0 }];
}
