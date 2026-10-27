// 配乐 / 音效脚本：用 synth 合成原创声音，返回音轨列表。
// 参数：{ synth, sfx, duration, outDir, shots, cues, log }；sfx 是风格的录音音效库（如 keynote，见风格的 SFX.md），风格没有时为 null
// 配乐、环境声、音效各写一个文件：剪映草稿里各占一条轨，后期能分开调。某类不用就从返回列表里删掉。
export default async function ({ synth, duration, outDir }) {
  const bgm = synth.buffer(duration); // 配乐
  // synth.qin(bgm, { at: 0.5, note: 'D3', dur: 5 });
  const ambience = synth.buffer(duration); // 环境声（整片铺底）
  // synth.water(ambience, { from: 0, to: duration, gain: 0.2 });
  const fx = synth.buffer(duration); // 点状音效
  // synth.knock(fx, { at: 2 });          // 合成
  // sfx.place(fx, 'ding', { at: 2 });    // 录音（风格有音效库时）
  for (const buf of [bgm, ambience, fx]) synth.reverb(buf, { mix: 0.25 });
  return [
    { file: synth.writeWav(bgm, `${outDir}/bgm.wav`), start: 0, gain: 0 },
    { file: synth.writeWav(ambience, `${outDir}/ambience.wav`), start: 0, gain: 0 },
    { file: synth.writeWav(fx, `${outDir}/sfx.wav`), start: 0, gain: 0 },
  ];
}
