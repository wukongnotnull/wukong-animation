# 审查遗留的小 bug

关联 issue：[wukongnotnull/wukong-animation#32](https://github.com/wukongnotnull/wukong-animation/issues/32)

## 1. 问题与目标

#26、#30 代码审查时记下、当时没修的 6 个小 bug。都不会让片子出错到看不出来，但都属于「悄悄出错、没有提示」。目标：每一处要么改对，要么明确报出来。

| # | 问题 | 改成 |
|---|---|---|
| 1 | 人声改名或删掉后，旧的逐字同步点 `甲#1…` 留在 film.json，镜头读到过期时间不报错 | `wka soundtrack` 清掉不再对应任何 `chars: true` 人声的逐字点，并打印清掉了哪些 |
| 2 | 两句人声用同一个 cue 名，后一句悄悄覆盖前一句 | `wka soundtrack` 发现重名直接报错，指出是第几条 |
| 3 | 只有一个镜头时 `wka animatic` 不出接触表 | 一张静帧也出接触表（带标注），`review/接触表.jpg` 照常生成 |
| 4 | QC 超标帧接触表在 ffmpeg 不带 drawtext 时没有标注 | 和 #30 一样改由 Chromium 画标注 |
| 5 | 片子自己改的字幕字体在剪映对照表里没有时，草稿悄悄用剪映默认字体 | 导出剪映草稿时打印提示，说明用了默认字体、要补哪一项 |
| 6 | `--rate=-20%` 这种等号写法被悄悄忽略 | 所有命令都支持 `--选项=值` |

已核实的事实：

- `audio/soundtrack.mjs` 的 `writeVoiceCues` 只对当前每句人声调 `clearCharCues(film.cues, name)`，名字已经不在 voices 里的逐字点不会被清。手写的音效同步点（如「落印」）和人声同步点都在 `cues` 里，分不出谁是人声的，所以只清 `名#数字` 形式的逐字点（它们只可能由 soundtrack 写出）。
- cue 名缺省是 `vo1`、`vo2`……（按序号，不会重名）；重名只会出在手写的 `voices[].cue`。schema 表达不了「数组里某字段唯一」。
- `core/job.mjs` 的 `stills()`：`if (contactSheet && files.length > 1)` 包住了整段，里面 `files.length === 1` 的复制分支走不到。
- `core/qc.mjs` 逐帧用 ffmpeg 抽超标帧、用 `drawLabel` 标时间点；没有 drawtext 时只打印提示。
- `exporters/jianying/plan.mjs` 里对照表没有的字体返回 `font: null`，不打印任何东西。lint 只查风格 `style.json` 的字幕字体，查不到片子 `film.json` 的 `subtitles.style`。
- `bin/wka.mjs` 的 `opt(name)` 只认 `argv` 里正好等于 `--name` 的项。

## 2. 改动范围

- `plugin/engine/audio/soundtrack.mjs`（1、2）、`audio/char-cues.mjs`（1，新增一个纯函数）
- `plugin/engine/core/job.mjs`（3）、`core/qc.mjs`（4）
- `plugin/engine/exporters/jianying/index.mjs`（5）
- `plugin/engine/bin/wka.mjs`（6）
- 文档只在 director SKILL 第 7 道补一句「cue 名不能重复」。
- 不改：渲染管线、镜头哈希、cue 的写法和读法。

## 3. 行为

### 3.1 清掉孤立的逐字点（问题 1）

- `char-cues.mjs` 新增 `orphanCharCues(cues, keepNames)`：返回 `cues` 里所有形如 `名#数字`、但 `名` 不在 `keepNames` 里的键。
- `writeVoiceCues` 写完本次所有人声后，用「本次 `chars: true` 的人声 cue 名」调它，删掉这些键，打印一行 `· 清掉了已不用的逐字同步点：甲#1…#5`（按名字归并）。
- 只清 `名#数字`；不带 `#数字` 的同步点（人声的、手写音效的）一概不动。

### 3.2 cue 名重复就报错（问题 2）

- `mixSoundtrack` 开头检查 `audio.voices` 的 cue 名（含缺省的 `voN`）：有重复就报错，什么都不写：

  ```
  人声的同步点名重复：「甲」用在第 1、3 条。每条人声的 cue 名要不同（film.json 的 audio.voices[].cue）
  ```

### 3.3 一张静帧也出接触表（问题 3）

- `stills()` 只要有静帧、调用方要接触表，就生成接触表。只有一张时不拼图，只缩放加标注（有 drawtext 用 drawtext，没有用 Chromium 标注），同样输出 `stills/sheet.jpg`；`animatic()` 照旧复制到 `review/接触表.jpg`。
- 删掉走不到的复制分支。

### 3.4 QC 接触表的标注（问题 4）

- `qc.mjs` 抽超标帧时：有 drawtext 照旧；没有时先用 `renderLabels` 一次画好所有标注，抽帧命令里叠上对应的标注 PNG（位置、大小与原 drawtext 一致）。
- 画不了（没装 browser 管线依赖、Chromium 起不来）时照旧打印原来的提示，不中断 QC。
- 标注的绘制逻辑和 #30 的 `labelInputs` 共用，放到 `core/labels.mjs`，`job.mjs` 和 `qc.mjs` 都从那里取。

### 3.5 片子字幕字体没有剪映对照时提示（问题 5）

- 导出剪映草稿、有字幕时：字幕字体（叠加片子 `subtitles.style` 之后的结果）不在对照表里，打印：

  ```
  ! 字幕字体「Long Cang」在剪映字体对照表里没有对应项，草稿里用剪映默认字体。
    要指定剪映字体，在插件的 engine/exporters/jianying/fonts.json 补一项（这需要改插件，告诉开发者）
  ```

- 对照表里值为 `null` 的字体是有意用默认字体，不提示。
- director 第 14 道交付时，日志里有这条提示就转告用户。

### 3.6 支持 `--选项=值`（问题 6）

- `opt(name)`：先找正好等于 `--name` 的项（取下一项为值，规则不变）；再找以 `--name=` 开头的项，取等号后面的部分（可以为空串，空串当作没给值，返回 `true`）。
- `pos` 的过滤规则不变：`--name=值` 本身以 `--` 开头，已经不会被当成位置参数，后面的参数也不会被吃掉。

## 4. 不做什么

- 不清理孤立的普通同步点（不带 `#数字` 的），它们可能是手写的音效点。
- 不自动补剪映字体对照。
- 不改 audition 失败时已删掉旧试听文件的行为（审查认为可以接受）。

## 5. 测试计划（先写失败的测试）

| # | 测试 | 位置 |
|---|---|---|
| 1 | `orphanCharCues`：只返回名字不在保留表里的 `名#数字`；`落印`、`甲`、`甲#a` 不在其中 | `tests/unit/char-cues.test.mjs` |
| 1 | 集成：先给「甲」写逐字点，改名为「乙」后再 `wka soundtrack`，`甲#*` 被清掉、`乙#*` 写出、手写的「落印」还在 | `tests/integration/render.test.mjs` |
| 2 | 两条人声都写 `cue: "甲"`：`wka soundtrack` 退出码非 0，报「第 1、2 条」，film.json 不变 | `tests/integration/render.test.mjs` |
| 3 | 单镜头片子 `wka animatic` 生成 `review/接触表.jpg`，左上角有标注（模拟没有 drawtext） | `tests/integration/render.test.mjs` |
| 4 | 模拟没有 drawtext、制造一处超标（全黑一镜），`wka qc` 的 `stills/qc/qc-sheet.jpg` 左上角有标注，日志里没有「不加文字标注」 | `tests/integration/render.test.mjs` |
| 5 | 剪映导出：`film.json` 的 `subtitles.style.font.family` 写 `Long Cang`，日志出现「在剪映字体对照表里没有对应项」；写 `Noto Sans SC`（值为 null）不出现 | `tests/integration/jianying.test.mjs` |
| 6 | `wka audition --text=句 --rate=-20%` 用假引擎时拿到 `rate: -20%`（或直接测导出的 `opt` 解析函数） | 把 `opt` / `pos` 解析抽成 `bin/args.mjs` 的纯函数，测 `tests/unit/args.test.mjs` |

## 6. 验收标准

- A1 改名、删人声后，旧逐字点被清掉，手写音效点不动。
- A2 cue 重名时 `wka soundtrack` 报错并指出条目。
- A3 单镜头片子有 `review/接触表.jpg`。
- A4 本机 `wka qc` 的超标帧接触表有标注。
- A5 片子字幕字体没有剪映对照时，导出日志有提示。
- A6 `--选项=值` 在所有命令里都生效。
- A7 全部测试、smoke、lint、build-docs 检查通过。
