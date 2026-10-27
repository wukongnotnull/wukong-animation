# 剩余四项：接触表镜号、景别检查、逐字时间、剪映字体对照

关联 issue：[wukongnotnull/wukong-animation#24](https://github.com/wukongnotnull/wukong-animation/issues/24) 第 4、5、7 条，以及《春晓》试拍发现的接触表无标注问题

## 1. 问题与目标

| # | 问题 | 目标 |
|---|---|---|
| 1 | ffmpeg 不带 drawtext（Homebrew 默认构建就不带）时，接触表和动态分镜上没有镜号 | 不依赖 drawtext 也能标镜号 |
| 2 | 景别规则（4 镜及以上至少 3 种、相邻两镜不同）只写在导演规则里，靠自觉 | 引擎检查，第 5 道签批时不合规就拦住 |
| 3 | 题字要跟着人声逐字出现，导演只能手工用 silencedetect 量 | `wka soundtrack` 自动写出每个字的时间 |
| 4 | 剪映字体对照只有马善政 → 古风小楷一条，新风格的字幕字体在剪映里会变成默认字体，没人发现 | 对照表单独成文件，lint 检查每个风格的字幕字体都写了对照 |

已核实的事实：

- `core/ffmpeg.mjs` 的 `drawLabel()` 在没有 drawtext 时返回空串；`stills()` 的接触表和 `animatic()` 的每镜画面都靠它加标注。本机 ffmpeg 不带 drawtext。
- 字幕烧录（`core/subtitle-layer.mjs`）已经用 Chromium 渲染透明 PNG、再用 ffmpeg `overlay` 叠上去，不依赖 drawtext。
- `film.schema.json` 的 `shots[]` 没有景别字段，景别只写在 `storyboard.md` 的表格里。
- edge-tts 7.3.1 的 `WordBoundary` 对中文只按短语给时间（「春眠不觉晓」整句一个时间），不到单字；CLI 的 `--write-subtitles` 只给整句。录音（自供）没有任何时间信息。
- 镜头里读同步点用 `s.cueIn('名')` / `s.cueOut('名')`；`core/cues.mjs` 静态找出镜头用到的 cue 名，镜头缓存只随这些 cue 失效。
- `exporters/jianying/plan.mjs` 里 `JIANYING_FONTS = { 'Ma Shan Zheng': '古风小楷' }`。仓库里用到的字体：Ma Shan Zheng（ink-wash 字幕）、Zhi Mang Xing（ink-wash 题字）、Noto Sans SC（引擎字幕缺省）。pyJianYingDraft 0.3.1 的 `FontType` 有 798 个字体，含 `古风小楷`、`毛笔行楷`、`思源中宋`，没有思源黑体。

## 2. 架构与组件边界

```
1 镜号     core/labels.mjs（新）       Chromium 渲染标注 PNG；stills() / animatic() 没有 drawtext 时用它 overlay
2 景别     schemas/film.schema.json   shots[].size
           core/shot-sizes.mjs（新）   checkShotSizes(shots) → 问题列表
           bin/wka.mjs                signoff --step 5 不合规就拒绝（--force 放行并记下）；qc 打印检查结果
3 逐字时间 audio/char-cues.mjs（新）   按静音切分句、句内按字数均分 → cues 里的 名#1…名#n
           audio/soundtrack.mjs       voices[].chars 为 true 的条目写逐字 cue
           runtime/wk.js              s.cueChars('名') → [{in, out}, …]（镜头内时间）
           core/cues.mjs              认 s.cueChars('名') 的字面量写法
4 字体     exporters/jianying/fonts.json（新）  对照表；plan.mjs 读它
           tools/lint.mjs             风格的字幕字体、引擎缺省字幕字体必须在对照表里有一项（值可以是 null）
```

- 文档：`plugin/skills/director/SKILL.md`、`STORYBOARD.md`、`SHOT.md`、`docs/PRODUCTION-WORKFLOW.md`（升 v1.6.0）、`plugin/engine/exporters/jianying` 相关说明。
- 不改：渲染管线、镜头哈希算法（只扩充 cue 名的识别）、字幕烧录、QC 指标。
- `runtime/wk.js` 改了，所有镜头缓存会失效一次。

## 3. 接口、数据与行为

### 3.1 不依赖 drawtext 的镜号标注

- 新增 `core/labels.mjs`：`renderLabels(texts, { size, workDir })` 启动一次 Chromium，每个文字渲染一张透明背景 PNG（白字、半透明黑底圆角框，和现在 drawtext 的样子一致），返回文件路径数组。依赖 playwright；没有时抛错，调用方降级为不标注并照旧提示。
- `stills()` 的接触表：有 drawtext 时照旧；没有时每张缩略图叠一张「`s02 2.7s`」标注 PNG，位置左上角 (10, 10)。
- `animatic()`：有 drawtext 时照旧；没有时每镜叠一张「`s02`」标注 PNG，位置 (20, 20)，字号 28。
- 原来的提示「ffmpeg 不带 drawtext，接触表不加文字标注」只在 playwright 也不可用时才打印。
- 标注 PNG 放 `.cache/work/labels/`，每次覆盖。

### 3.2 景别检查

`film.json` 的 `shots[]` 加可选字段 `size`，取值：`大远景`、`远景`、`全景`、`中景`、`近景`、`特写`、`大特写`。

`checkShotSizes(shots)` 返回问题列表（空表示通过）：

| 规则 | 问题文字 |
|---|---|
| 任何一镜没写 `size` | 镜头 s03 没有写景别（film.json 的 shots[].size） |
| 4 镜及以上，景别少于 3 种 | 8 个镜头只用了 2 种景别（近景、特写），至少要 3 种 |
| 相邻两镜景别相同 | s04 和 s05 都是特写，相邻两镜景别要不同 |

- 3 镜及以下只检查「都写了」和「相邻不同」。
- `wka signoff <片> "…" --step 5`：有问题就逐条打印并拒绝签批（退出码非 0，不记进度、不提交）；加 `--force` 时照常签批，并在签批记录的结论后面附上「（景别检查未通过：…）」。
- `wka qc`：在表格后面打印一行「景别：近景 → 远景 → …（5 种，相邻都不同）✓」，或列出问题 ✗。只报告，不影响 QC 通过与否。
- 已经过了第 5 道的在制片子不受影响（不回头检查）。

### 3.3 逐字时间

`audio.voices[]` 加可选字段 `chars: true`。这一句的每个字（不算标点）都会得到一个同步点。

`wka soundtrack` 对 `chars: true` 的条目：

1. 取这句的音频（AI 配音或自供录音），做静音检测（-40dB、静音至少 0.15 秒），得到这句里有声音的几段。
2. 按句中标点把文字切成分句（不含标点的字数大于 0 的才算）。
3. 有声音的段数等于分句数：每个分句对应一段。段数不等：整句当一段。
4. 每段里按字数均分时间，第 k 个字得到 `[入点, 出点]`（全片时间，保留 3 位小数）。
5. 写进 `film.json` 的 `cues`，键名为 `<cue名>#1`、`<cue名>#2`……（从 1 开始，按字的顺序）。这句以前写过的 `<cue名>#*` 先全部删掉再写。
6. 没有音频（没装 TTS、按字数估算）时，在估算的入出点之间按字数均分，日志标明「估算」。

镜头里用：

```js
const chars = s.cueChars('第四句');   // [{ in: 0.12, out: 0.43 }, …]，镜头内时间（秒）
```

- `cueChars` 找不到这个 cue 名的逐字同步点时抛错，提示「在 voices 里给这一句加 "chars": true，再运行 wka soundtrack」。
- `core/cues.mjs` 认 `s.cueChars('名')` 的字面量写法：镜头用到的 cue 名里加上所有 `名#n`，镜头缓存只随这些失效。动态参数照旧退回「全部 cue 都算」。
- SHOT.md「屏幕文字与人声对位」一节改成先用 `cueChars`，silencedetect 手工量的做法留作没有逐字 cue 时的备用。

### 3.4 剪映字体对照表

- 新文件 `exporters/jianying/fonts.json`：`{ "<网页字体名>": "<剪映字体名>" | null }`。`null` 表示用剪映默认字体，是有意为之。初始内容：

| 网页字体 | 剪映字体 |
|---|---|
| Ma Shan Zheng | 古风小楷 |
| Zhi Mang Xing | 毛笔行楷 |
| Noto Serif SC | 思源中宋 |
| Noto Sans SC | null（剪映默认就是黑体） |

- `plan.mjs` 读这个文件，代替写死的 `JIANYING_FONTS`。
- `tools/lint.mjs` 加一条：每个风格 `style.json` 里 `subtitles.font.family`，以及引擎缺省字幕字体，都必须在对照表里有一项（值可以是 `null`），缺了就报错并写明要补哪个字体。
- 测试：装了 pyJianYingDraft 时，检查表里所有非 `null` 的值都是 `FontType` 里的名字。

## 4. 不做什么

- 不做 edge-tts 之外引擎的真正逐字对齐（强制对齐模型等）；逐字时间是按静音分句、句内均分的近似值。
- 不回头检查已经过了第 5 道的片子的景别。
- 不做快速审片模式（#24 第 8 条，用户决定暂时不做）。
- 不给剪映补字体文件，只做名字对照。

## 5. 测试计划（先写失败的测试）

| # | 测试 | 位置 |
|---|---|---|
| 1 | `renderLabels` 生成透明 PNG，尺寸大于 0、有不透明像素；假装没有 drawtext 时 `wka animatic` 仍生成接触表，左上角标注区域比纸色暗 | `tests/integration/render.test.mjs` |
| 2 | `checkShotSizes`：全部合规 → 空；缺 size、种类不足、相邻相同各一条；3 镜时不查种类 | `tests/unit/shot-sizes.test.mjs`（新） |
| 2 | schema 接受 7 种景别、拒绝「大全景」 | `tests/unit/voice-kind.test.mjs` 同类位置 |
| 2 | `wka signoff --step 5` 不合规时退出码非 0、不提交；加 `--force` 签批成功、记录里附问题 | `tests/integration/render.test.mjs` 或新建 `signoff.test.mjs` |
| 3 | `charCues`：两段声音对两个分句 → 每段内均分；段数不等 → 整句均分；标点不占时间；键名 `名#1…` | `tests/unit/char-cues.test.mjs`（新） |
| 3 | `usedCueNames` 认 `s.cueChars('第四句')`；`pickCues` 带上 `第四句#*` | `tests/unit/cues.test.mjs` |
| 3 | 集成：自供录音（两段 tone 中间静音）+ `chars: true` → `wka soundtrack` 写出逐字 cue；镜头里 `s.cueChars` 能读到 | `tests/integration/render.test.mjs` |
| 4 | `fonts.json` 被 plan 读到；lint 在风格字幕字体缺对照时报错；装了 pyJianYingDraft 时非 null 值都存在 | `tests/unit/jianying-plan.test.mjs`、lint 自测 |

## 6. 验收标准

- A1 本机（ffmpeg 不带 drawtext）`wka animatic` 的接触表和动态分镜每镜都有镜号。
- A2 景别不合规的 film.json，`wka signoff --step 5` 被拒绝并列出问题；`wka qc` 打印景别检查结果。
- A3 给《春晓》第四句加 `chars: true` 后 `wka soundtrack`，film.json 出现 `第四句#1`…`第四句#5`；镜头里用 `s.cueChars('第四句')` 题字逐字出现。
- A4 lint 检查剪映字体对照；对照表有 4 项。
- A5 SKILL.md、STORYBOARD.md、SHOT.md、PRODUCTION-WORKFLOW.md（v1.6.0）同步。
- A6 全部测试、smoke、lint、build-docs 检查通过。
