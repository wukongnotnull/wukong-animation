# 声音收尾：音效听感审计、背景音乐随人声闪避、-14 LUFS 两遍母带 设计

关联：#46（来自讨论 #45 第一组）；前置：#43 / #44 录音音效库。

## 1. 问题与目标

用户的 wk-motion-graphics 在声音上还有三样本仓库没有：

| 源 skill | 做什么 | 本仓库现状（已核实） |
| --- | --- | --- |
| `sfx_audit.py` | 每个音效起点比较"只有音效"和"人声 + 音乐"两条轨的电平，低于人声 3 dB 记为被盖住，按音效汇总并列出时间点 | 没有 |
| `Soundtrack.tsx` + `make_sounds.py` | 合成与成片等长的背景音乐（96 BPM，Fmaj7–Em7–Dm7–Cmaj7，前 4 小节无鼓，之后 8 小节循环，淡入 1.5 s、淡出 3 s）；说话时背景音乐压到 0.24、停顿时 0.5，提前 6 帧下压、结束后 14 帧回升 | `synth` 只有 qin / water / knock，没有这种铺底音乐；没有闪避 |
| `master.sh` | 两遍 `loudnorm`（先测量、再按测量值线性应用）到 -14 LUFS / TP -1.5 / LRA 11；测出 -inf（静音）时不归一化 | `wka soundtrack` 单遍 `loudnorm=I=-18:TP=-1.5:LRA=11` 写 `.cache/mix.wav`；单遍实测会偏离目标（源 skill 记录：目标 -14 只到 -15.2） |

目标：keynote 片子的声轨和源 skill 一样——有可闪避的背景音乐、成片响度准确落在 -14 LUFS、每次出声轨都告诉你哪些音效被人声盖住了。

## 2. 架构与组件边界

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| 铺底音乐 | `engine/audio/synth.mjs` 新增 `bed(buf, o)` | 把源 `make_sounds.py` 的背景音乐移植成 JS，写进 synth 缓冲 |
| 闪避 | `engine/audio/duck.mjs`（新） | 按人声区间算增益包络（纯函数）；把标了 `duck` 的音轨处理成闪避后的文件 |
| 母带 | `engine/audio/loudness.mjs`（新） | 两遍 `loudnorm`：测量 → 线性应用；静音直通 |
| 听感审计 | `engine/audio/audit.mjs`（新） | 混出"音效"和"其余"两条分轨，逐帧测电平，在每个音效起点比较（判定是纯函数） |
| 接入 | `engine/audio/soundtrack.mjs` | 混音前做闪避；混音后两遍母带替换单遍 `loudnorm`；最后跑审计并打印 |
| 风格声明 | `style.json` 新增可选 `loudness`（LUFS，数字）；keynote 设 `-14`；缺省 `-18` | 响度目标按风格定，水墨等现有风格不变 |
| 音效清单 | keynote `sfx.json` 的 `subtype` 加 `"quiet": true` | 审计里只列不报（源 `QUIET = {"subtype"}`） |

小样、终版 mp4、审听 `review/声轨.m4a` 都来自 `.cache/mix.wav`，所以母带在 `wka soundtrack` 里做一次，下游全部一致。

## 3. 接口、数据与行为

### 3.1 背景音乐 `synth.bed(buf, { from = 0, to = buf.seconds, gain = 1, seed = 7 })`

- 音乐内容按源 `make_sounds.py` 移植：和弦 Fmaj7 / Em7 / Dm7 / Cmaj7 循环；pad（正弦叠加 + 微失谐，缓起缓收）、bass（根音 1、2.5、3 拍）、鼓（kick 1、3、3.5 拍，军鼓 2、4 拍带通噪声，八分音符踩镲）、琶音（高八度，8 音型）；前 4 小节只有 pad + bass，之后 8 小节一循环。
- `from`–`to` 区间内生成，起点淡入 1.5 s、终点淡出 3 s；整段峰值归一到 0.71（源：`gain 0.8 × 0.89`），再乘 `gain` 叠加到 `buf`（立体声左右相同）。同一 `seed` 结果完全相同。

### 3.2 闪避

- `audio/build.mjs` 返回的音轨可以带 `duck: true`：`{ file: 'bgm.wav', start: 0, gain: -6, duck: true }`（`-6` dB ≈ 源的 0.5"停顿时"电平）。
- 人声区间取本次 `wka soundtrack` 实测的每条人声 `[at, at + duration]`（与写进 `cues` 的同一组数）。
- 包络（纯函数 `duckEnvelope(intervals, seconds, sr)`）：说话时 0.48（= 源 0.24 / 0.5），停顿时 1；每段人声开始前 0.2 s（源 6 帧）线性压下，结束后 0.47 s（源 14 帧）线性回升；多段重叠取最深。
- 处理后写 `audio/generated/ducked/<原文件名>`，混音和剪映草稿都用这个文件（文件名不变，草稿里轨道名还是 `bgm.wav`）：审听听到的就是草稿里的。
- 没有人声时不处理，打印"没有人声，背景音乐不闪避"。

### 3.3 母带（两遍）

- 第一遍：把各音轨按现有方式混好（`adelay`、`volume`、`amix`、`apad`、`atrim`、末尾淡出）写 `.cache/premix.wav`，再 `loudnorm=I=<目标>:TP=-1.5:LRA=11:print_format=json` 测量。
- 第二遍：`loudnorm=…:measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:offset=…:linear=true` 写 `.cache/mix.wav`（48 kHz）。
- 目标 `I` = 风格 `loudness`，缺省 -18。
- 测出 `input_i` 为 `-inf` / 空：直接拷贝 premix，打印"声轨没有可测响度，未做响度标准化"。
- 日志打印"响度 -14.0 LUFS（目标 -14）"，数值取第二遍输出的 `output_i`。

### 3.4 听感审计

- 只在本次配乐脚本用了 `sfx.place`（有放置记录）时运行。
- 分轨：返回音轨里文件名为 `sfx.wav` 的是"音效轨"，其余（人声、闪避后的背景音乐、环境声、`tracks`）为"其余"；两条分轨用和正式混音相同的延迟和增益，不做响度标准化（第二遍是线性增益，不影响相对电平）。
- 有放置记录却没有 `sfx.wav`：打印"音效没有单独写成 sfx.wav，跳过听感审计"。
- 逐帧（1/30 s）测单声道 RMS 电平（dBFS）。每个放置点取起点后 6 帧窗口：`差值 = 音效轨窗口内最大值 − 其余轨窗口内平均功率`；`差值 < -3 dB` 且该音效不是 `quiet` 记为被盖住。同一帧起的音效共用一次测量。
- 输出（不中断）：按音效汇总"次数 / 被盖住 / 最差差值"；被盖住的逐条列"全片时间、镜头、音效、差值"；最后一行合计。没有被盖住时只打一行合计。
- 处理建议写进文档（与源一致）：调高电平（`place` 的 `volume`）、挪到句间空档、换起音更脆的录音；改电平属于混音取舍，先把审计结果给用户看。

### 3.5 文档与示范片

- keynote `SFX.md`（文件名不变）新增「背景音乐」「听感审计」「响度」三段；`STYLE.md` §7 补一句背景音乐与闪避、响度 -14。
- director `SKILL.md` 第 7 道：说明 `duck: true`、风格响度、审计输出怎么看；片子模板 `audio/build.mjs` 注释里给出 `synth.bed` 与 `duck: true` 写法。
- 《七十二变》`audio/build.mjs` 加背景音乐 `synth.bed` → `bgm.wav`（`duck: true`；该片无人声，实际不闪避）。

## 4. 约束、兼容性与非目标

- 没写 `loudness` 的风格目标仍是 -18；单遍改两遍会让这些风格的成片响度更接近 -18（原来有偏差），属于修正。
- 不带 `duck` 的音轨、不用 `sfx` 的配乐脚本行为不变。
- 剪映草稿不做响度标准化（草稿里各轨独立，响度由剪映处理），只换用闪避后的背景音乐文件。
- 非目标：审计的 `--margin` / `--all` 参数（固定 -3 dB，只列被盖住的）、可配置的闪避深度与时间、终版 AAC 码率从 192k 改 256k、片子级覆盖响度目标。

## 5. 错误处理与运维

- ffmpeg 失败报出步骤名（混音 / 响度测量 / 响度应用 / 闪避 / 审计）与 ffmpeg 输出末尾。
- 测量结果解析不到 JSON：报错并附 ffmpeg 输出末尾，不静默退回单遍。
- `.cache/premix.wav` 与分轨文件是中间产物，留在 `.cache/`。

## 6. 验收标准与测试

1. 单元：`synth.bed` 同 seed 结果相同、写在 `from`–`to` 内、起点接近 0（淡入）、峰值 ≈ 0.71 × gain。
2. 单元：`duckEnvelope` 在说话中为 0.48、停顿为 1、前 0.2 s 下压与后 0.47 s 回升为线性、重叠取最深、无人声全为 1。
3. 单元：两遍母带把一段测试音频标准化到目标 ±0.5 LUFS（`ebur128` 复测）；静音输入不报错、原样输出。
4. 单元：审计判定函数——差值 < -3 dB 报被盖住；`quiet` 不报；同帧共用测量。
5. 集成：keynote 片子用自供录音（测试里合成的 wav）+ 带 `duck` 的背景音乐 + 一个被压在人声下的轻音效，`wka soundtrack` 后：`mix.wav` 实测 -14 ±0.5 LUFS；`ducked/bgm.wav` 在人声区间比停顿处低约 6.4 dB；日志列出被盖住的音效和时间。
6. 集成：ink-wash 片子 `mix.wav` 实测 -18 ±0.5 LUFS。
7. `node --test tests/unit/*.test.mjs tests/integration/*.test.mjs`、`node tools/lint.mjs`、冒烟测试全过。
8. 手动：《七十二变》`wka soundtrack` 审听背景音乐（需先 `wka sfx` 下载音效，经用户同意）。
