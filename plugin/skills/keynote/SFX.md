# 发布会 Keynote · 音效

音效用**录音**（Mixkit 免版税库），不用代码合成。清单在 `sfx.json`（名字 → Mixkit 编号、场合、限长 `maxSeconds`、电平 `level`），音频按需下载到 `~/.wukong-animation/cache/sfx/keynote/`，插件里不带音频文件。这套音效和电平沿用用户 wk-motion-graphics 定下的版本。

## 语义化音效表

| 场合 | 音效 | 名字 | Mixkit id | 电平 |
| --- | --- | --- | --- | --- |
| 开场 | 水滴 | drop | 3179 | 0.9 |
| 说观点 | 叮 | ding | 931 | 0.37 |
| 悬疑 | 轻敲 | tap | 197 | 0.42 |
| 要放大（推近） | 界面放大 | spring | 2617 | 0.29 |
| 切镜 | 嗖嗖 | swish | 166 | 0.25 |
| 数字类 | 撒金币 | coins | 1993 | 0.32 |
| 划重点 | 拳击 | punch | 2155 | 0.45 |
| 惊讶 | 刀光 | blade | 1506 | 0.32 |
| 出字幕 | 打字 | subtype | 2534 | 0.11 |
| 爆粗口 | 短消音 | bleep | 1082 | 0.5 |
| 鼠标单击 | 单击 | click | 1113 | 0.6 |
| 发消息 / 弹出 | 气泡 | pop | 2354 | 0.35 |
| 打出地址 / 命令 | 键盘 | typing | 1376 | 0.4 |
| 东西出现（卡片、窗口弹出） | 轻泡泡 | appear | 3005 | 0.35（很轻，落在人声上听不太出，必要时调大或换 2358 Long pop） |
| 嘟咚提示（规则写入、提示出现） | 嘟咚 | dudong | 2866 | 0.35 |
| 可爱提示 | 叮铃 | cute | 937 | 0.4（备用） |
| 任务完成（汇报卡片、片尾点关注） | 上扬两声 | success | 2870 | 0.4 |
| 滑动、滚动 | 唰 | swipe | 2627 | 0.3 |

电平是相对人声的混音音量；文件已峰值归一到 -1 dBFS。

## 用法

```js
// audio/build.mjs
export default async function ({ synth, sfx, duration, outDir, cues }) {
  const buf = synth.buffer(duration);
  sfx.place(buf, 'drop', { at: 0 });                       // 开场
  sfx.place(buf, 'ding', { at: cues['第二句'][0] });         // 说观点：对齐人声同步点
  sfx.place(buf, 'click', { at: 6.4, volume: 0.8 });       // volume 乘在电平上
  return [{ file: synth.writeWav(buf, `${outDir}/sfx.wav`), start: 0, gain: 0 }];
}
```

- 时刻用全片时间（秒）。镜头里的帧号换成全片时间：`镜头 start + 帧号 / fps`（`shots` 参数里有每镜的 `start`）。
- 和画面对应：`<Cursor clicks>` 的每个点击帧放 `click`；`zoomInFrames(beats, stages)` 给出的第一次推近放 `spring`；`fade` 接缝（真正换话题）放 `swish`。
- 配乐和音效分开写 `bgm.wav` / `sfx.wav`：听感审计按文件名 `sfx.wav` 认音效轨，剪映草稿里也各占一条轨。

## 背景音乐

```js
const bgm = synth.buffer(duration);
synth.bed(bgm);                                            // 96 BPM 铺底：开头淡入 1.5 秒、结尾淡出 3 秒
tracks.push({ file: synth.writeWav(bgm, `${outDir}/bgm.wav`), start: 0, gain: -6, duck: true });
```

- `synth.bed(buf, { from, to, gain, seed })`：Fmaj7 / Em7 / Dm7 / Cmaj7 循环，前 4 小节只有铺底和贝斯，之后加鼓和琶音。用户认可了这个音量（`gain: -6` 对应源工程停顿时的 0.5），不要再调。
- `duck: true`：按 `wka soundtrack` 实测的人声区间闪避——说话时压到停顿时的 0.48 倍，开口前 0.2 秒开始下压，说完 0.47 秒回升。处理后的文件在 `audio/generated/ducked/`，混音和剪映草稿都用它。

## 听感审计

`wka soundtrack` 每次都会审计（用了 `sfx.place` 才跑）：把 `sfx.wav` 和其余音轨（人声、闪避后的背景音乐…）分开混，在每个音效起点比电平，音效比其余低 3 dB 以上算被盖住，按音效汇总并列出时间点和镜头。出字幕的打字声 `subtype` 是故意做轻的（清单里 `quiet`），只列不报。

被盖住时的三种改法：调高这个音效（`place` 的 `volume`）；挪到不说话的空档（比如句间停顿）；换一个起音更脆的录音。改电平属于混音取舍，先把审计结果给用户看再动。源工程实测：每页开头的切镜嗖声在开口即说的页里常被盖住（23 次中 8 次）。

## 响度

keynote 的 `style.json` 写了 `"loudness": -14`：`wka soundtrack` 先混好、用 ebur128 测量，再按测量值线性应用 loudnorm，声轨（以及小样、终版 mp4、审听文件）落在 -14 LUFS、真峰值 ≤ -1.5 dBTP。日志里的"响度 -14.0 LUFS（目标 -14）"是复测值。剪映草稿各轨独立，不做响度标准化。

## 密度规则（用户反馈"太密"后定下的）

- 每镜最多一个"叮"。
- 出字幕打字声只在每镜第一句出现时响。
- 点击只有单击声，同一帧不叠别的音效。
- 切镜嗖声只在真正换话题（`fade` 接缝）时响，`hold` 接缝不响。
- 拳击声只给真正的重点框，不是每个高亮都放。
- 同一拍不叠两个强调音（例："叮"和推近的放大音同帧时，去掉"叮"）。
- 推近可放一声 `spring`，拉远不放。

`wka soundtrack` 会对"一镜两个 ding""两个音效同一帧"打印「音效太密」警告；其余几条要自己守。

## 获取音效（许可）

1. **下载前**运行 `wka sfx <片目录> --list`（只发 HEAD 请求），把名字 / 来源 URL / 大小表给用户确认。
2. 用户同意后运行 `wka sfx <片目录>`：下载缺的文件，去前导静音、限长 `maxSeconds`、60 ms 淡出、峰值归一到 -1 dBFS。已下载的不重复下载；改了 `sfx.json` 会重新处理。
3. 没下载就 `wka soundtrack`，配乐脚本会报"还没下载"，不会悄悄换成合成音。

Mixkit 许可：可商用、免署名，但**不可再分发文件本身**。所以只在本机缓存，不进 git、不拷进片目录；剪映草稿引用的是混好的 `sfx.wav`。

不提取、不使用剪映官方音效或其缓存（许可只限剪映内使用）；用户想用，告诉用户需要在剪映里自己加。

## 推荐与试听（换音效、加音效时）

1. 在 Mixkit 分类页找同类：`https://mixkit.co/free-sound-effects/<分类>/`（zoom、notification、pop、whoosh、crowd、cheer…）。每条的预览地址在页面的 `data-audio-player-preview-url-value` 属性上，编号就在 URL 里。
2. 征得用户同意后，把 3–6 个候选的预览 mp3（`https://assets.mixkit.co/active_storage/sfx/<id>/<id>-preview.mp3`）下到临时目录发给用户试听；用表格列出编号、名称、时长、感觉，给一个推荐和理由（时长贴合动作、音色和画面风格一致、重复多次不腻）。
3. 用户定了编号：这是改插件文件，不在片目录里改。告诉用户需要更新插件的 `sfx.json`（`maxSeconds` 按动作时长定），由开发者改好后再 `wka sfx`。
4. 新增一类音效先定"场合"（用在哪些镜、哪一拍）；不定场合的音效不加。

## 剪映音效名 → Mixkit 对照

用户拿剪映的音效名来要时按这张表找：

| 剪映 | Mixkit |
| --- | --- |
| 键盘打字（快）/ 打字声 | typing 1376 · subtype 2534 |
| 叮的一声 / 叮 | ding 931 · 933 Bell notification |
| 一滴水滴声 | drop 3179 |
| 鼠标单击 | click 1113 |
| "呼"的转场音效 | swish 166 · 1489 Air woosh |
| 嗖嗖 | blade 1506 · 1490 Fast whoosh transition |
| 啵 / 啵，点赞 | pop 2354 · 2357 Bubble pop up alert |
| 东西突然出现 | appear 3005 · 2358 Long pop |
| 嘟咚，提示音 | dudong 2866 · 911 Interface hint notification |
| Ding，可爱提示音 | cute 937 · 2344 Magic notification ring |
| 打卡成功 | success 2870 · 2867 Confirmation tone · 951 Positive notification |
| 唰 | swipe 2627 · 1492 Cinematic whoosh fast transition |
| 欢呼 / 掌声 | 459 Male crowd cheering short · 531 Birthday crowd party cheer · 437 Small crowd ovation |

表里不在 `sfx.json` 的编号是候选，要用先按上面「推荐与试听」加进清单。
