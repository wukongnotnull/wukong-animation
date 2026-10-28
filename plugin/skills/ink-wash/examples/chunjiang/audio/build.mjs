// 《春江花月夜》配乐：稀疏的古琴拨弦（D 商调）+ 极轻的潮水流水铺底，落印一声"笃"。
// 古琴每一声都挂在人声同步点上（某句起念前一点），换配音后自动跟着走；背景音乐随人声闪避。
const QIN = [
  // [同步点, 提前秒数, 音, 余音]
  [null, 0.5, 'D3', 5], // 片名题字
  ['第2句', 0.4, 'A3', 5], // 海上明月共潮生
  ['第5句', 0.6, 'G3', 5], // 承 · 月照花林
  ['第9句', 0.6, 'E3', 4], // 转（上）· 江天一色
  ['第13句', 0.6, 'D3', 5], // 人生代代无穷已（与上一声隔开十余秒）
  ['第17句', 0.6, 'A2', 6], // 转（下）· 白云一片
  ['第21句', 0.6, 'C3', 5], // 可怜楼上月徘徊
  ['第27句', 0.6, 'D3', 5], // 鸿雁长飞
  ['第29句', 0.6, 'D3', 6], // 合 · 闲潭落花
];

export default async function ({ synth, duration, outDir, cues }) {
  const at = (cue, lead) => (cue ? cues[cue][0] - lead : lead);

  const bgm = synth.buffer(duration);
  for (const [cue, lead, note, dur] of QIN) synth.qin(bgm, { at: at(cue, lead), note, dur, gain: 0.3 });

  // 潮水流水：转（下）一段（白云 → 鱼龙）略压低，最后 3 秒淡出
  const ambience = synth.buffer(duration);
  const low0 = cues['第17句'][0] - 1;
  const low1 = cues['第28句'][1] + 1;
  synth.water(ambience, { from: 0, to: low0 + 1.5, gain: 0.1, fade: 3, drops: 0.3 });
  synth.water(ambience, { from: low0, to: low1 + 1.5, gain: 0.07, fade: 1.5, drops: 0.2, seed: 8 });
  synth.water(ambience, { from: low1, to: duration, gain: 0.1, fade: 3, drops: 0.3, seed: 9 });

  const sfx = synth.buffer(duration);
  synth.knock(sfx, { at: cues['落印'][0] });

  for (const buf of [bgm, ambience, sfx]) synth.reverb(buf, { mix: 0.25 });
  return [
    { file: synth.writeWav(bgm, `${outDir}/bgm.wav`), start: 0, gain: 0, duck: true },
    { file: synth.writeWav(ambience, `${outDir}/ambience.wav`), start: 0, gain: 0 },
    { file: synth.writeWav(sfx, `${outDir}/sfx.wav`), start: 0, gain: 0 },
  ];
}
