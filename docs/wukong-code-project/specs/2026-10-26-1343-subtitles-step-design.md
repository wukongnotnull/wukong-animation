# 字幕制作工序与字幕引擎功能设计

关联 issue：[wukongnotnull/wukong-animation#15](https://github.com/wukongnotnull/wukong-animation/issues/15)

## 1. 问题与目标

现在的流程里没有字幕：成片 mp4 不带字幕，也不出 srt；只有剪映草稿按人声一句一条地带字幕，不能调断句。屏幕文字已明确不包含字幕（`docs: 明确屏幕文字不包含字幕`）。

目标：

1. 制作流程新增第 11 道「字幕制作」和审片节点 ⑧，放在第 10 道小样之后、终版渲染之前；原第 11–13 道顺延为第 12–14 道。流程变为 **14 道工序 · 10 个审片节点**。
2. 在制片子的进度记录（`.wka/state.json`）自动迁移到新编号。
3. 引擎能从人声生成可手改的字幕文件，并按片子的设置在终版里烧录字幕、外挂 srt，剪映草稿的字幕也读这份文件。

已确认的决定（2026-10-26，issue #15）：

- 字幕工序位置：第 10 道之后、第 11 道之前。
- 烧录方式：独立字幕层。Chromium 把字幕渲染成透明 PNG，ffmpeg `overlay` 叠到拼好的画面上；镜头缓存不受字幕影响。
- 字幕数据：以片目录里的 `subtitles.srt` 为准，由 `wka subtitles` 生成，之后可以手改。
- 默认字体：Noto Sans SC，风格可在 `style.json` 里换。

已核实的事实：

- 本机 ffmpeg 8.0.1（Homebrew）没有 `subtitles`、`ass`、`drawtext` 滤镜，有 `overlay`。
- 第 10、12 道的 `wka qc` 读的是 `.cache/video.mp4`（无字幕），字幕层不影响 QC 指标。
- 人声的实测入出点由 `wka soundtrack` 写在 `film.json` 的 `cues`（名字为 `voices[].cue`，缺省 `vo1`、`vo2`……）。
- google/fonts 仓库有 `ofl/notosanssc/NotoSansSC[wght].ttf`（SIL OFL 1.1）。路径里的方括号会被 curl 当成通配符，地址里要写成 `%5B` / `%5D`。

## 2. 架构与组件边界

```
wka subtitles <片>            ── core/subtitles.mjs  buildSubtitles(voices, cues, opts) → cues[]（纯函数）
   [--force] [--preview]                            formatSrt / parseSrt / checkSubtitles（纯函数）
                              ── core/subtitle-layer.mjs  burnSubtitles(job, video, cues, out)
                                    Chromium 渲染透明 PNG → ffmpeg overlay
wka final <片>
  ├─ mixSoundtrack
  ├─ render → .cache/video.mp4（不变，QC 读它）
  ├─ mode 为 burn / both 且要导出画面：burnSubtitles → .cache/video-subtitled.mp4，交给 mp4 / gif / png-seq
  ├─ mode 为 srt / both：复制 subtitles.srt → <export.name>.srt
  └─ timeline.subtitles（来自 srt）→ jianying 导出器的字幕轨
core/state.mjs                ── 14 道工序、10 个节点；migrateProgress(st) 迁移旧编号
```

- 新文件：`plugin/engine/core/subtitles.mjs`、`plugin/engine/core/subtitle-layer.mjs`、`plugin/engine/runtime/subtitle.html`（字幕层宿主页）。
- 改动文件：`core/state.mjs`、`core/fonts.mjs`（`KNOWN_FONTS` 加 Noto Sans SC）、`bin/wka.mjs`、`exporters/jianying/plan.mjs`、`exporters/jianying/index.mjs`、`schemas/film.schema.json`、`schemas/style.schema.json`。
- 文档：`docs/PRODUCTION-WORKFLOW.md`（升 v1.2.0）、`plugin/skills/director/SKILL.md`、`plugin/skills/director/STORYBOARD.md`、`README.md`。
- 不改：镜头渲染管线（`pipelines/browser`）、镜头缓存哈希、`core/qc.mjs`、mp4 / gif / png-seq 导出器。

## 3. 接口、数据与行为

### 3.1 工序与审片节点

| 新编号 | 工序 | 审片节点 | 旧编号 |
|---|---|---|---|
| 1–10 | 不变 | ①–⑦ 不变 | 1–10 |
| 11 | 字幕制作 | ⑧ 字幕 | —（新增） |
| 12 | 终版渲染与终混 | — | 11 |
| 13 | 终检与交付 | ⑨ 终审 | 12 |
| 14 | 剪映草稿交付 | ⑩ 剪映草稿 | 13 |

`REVIEW_GATES = { 3:'①美术定调', 4:'②文学脚本', 5:'③分镜', 6:'④人声素材来源', 7:'⑤声轨审听', 8:'⑥风格帧与动态分镜', 10:'⑦小样', 11:'⑧字幕', 13:'⑨终审', 14:'⑩剪映草稿' }`，`LAST_STEP = 14`。

### 3.2 进度迁移

- `state.json` 新增字段 `"flow": 2`。没有这个字段的视为 flow 1（v0.4.0 及以前，含 12 道和 13 道两个时期；第 13 道是追加在末尾的，编号兼容）。
- `migrateProgress(st)`（纯函数，不改入参）：flow 1 → 2 时，`step >= 11` 的 `st.step` 与每条 `history[].step` 加 1，`label`、`gate` 按新表重填，置 `flow: 2`；其他字段原样保留。已是 flow 2 的原样返回。
- `readProgress` 读到 flow 1 时迁移并**写回文件**，保证导演直接读 `state.json` 时看到的也是新编号；`listProductions` 的结果带 `migrated: true`，`wka status` 打印一行「进度已按新流程（14 道工序）换算」。
- 新建的进度文件直接写 `flow: 2`。
- 例：《山水有回声》旧 `step: 12`（⑧ 终审已签批）→ 新 `step: 13`（⑨ 终审），下一步「14. 剪映草稿交付」。它不会被拉回第 11 道；要补字幕按返修处理（见 3.8）。

### 3.3 `film.json` 新字段

```json
"subtitles": { "mode": "srt", "file": "subtitles.srt", "max_chars": 18 }
```

| 字段 | 取值 | 缺省 |
|---|---|---|
| `mode` | `none` 不出字幕 / `srt` 只外挂 / `burn` 只烧录 / `both` 两者 | 没有 `subtitles` 字段即 `none` |
| `file` | 字幕文件，相对片目录 | `subtitles.srt` |
| `max_chars` | 每条字幕最多几个字（标点不计） | 按画幅：宽 > 高为 18，宽 < 高为 12，等宽为 14 |

第 2 道制作简报确认字幕方式，默认：有人声为 `srt`，无人声为 `none`。

### 3.4 断句与时间：`buildSubtitles(voices, cues, { maxChars })`

- 每条人声取 `cues[voices[i].cue || 'vo' + (i + 1)]` 的 `[入点, 出点]`；缺这个同步点就报错「先运行 wka soundtrack」。`voice_source` 为 `none` 时返回空数组。
- 一条人声的字数（不计标点和空白）不超过 `maxChars` 就是一条字幕；超过就拆：
  1. 先在句内标点（。！？；，、：）处切，从左到右贪心合并，每段不超过 `maxChars`；
  2. 仍超长的段按 `maxChars` 硬切。
- 拆出的各段按字数比例分配这条人声的时长，首尾相接。
- 每段去掉结尾的 `。，、；：`，保留 `？！…`。
- 返回 `[{ index, start, end, text }]`，按 `start` 排序，`index` 从 1 起。

### 3.5 srt 读写与检查

- `formatSrt(cues)`：标准 SRT，时间 `HH:MM:SS,mmm`，条目之间空一行，UTF-8 无 BOM，结尾换行。
- `parseSrt(text)`：兼容 BOM 和 CRLF；一条字幕可以有多行文字（行间用 `\n` 保留）；格式错误时报错并指出第几条。
- `checkSubtitles(cues, { duration, maxChars })` 返回警告列表，不中断：出点早于入点（错误，中断）、超出片长（错误，中断）、相邻两条重叠、单行超过 `maxChars`、单条短于 0.6 秒。

### 3.6 `wka subtitles <片目录> [--force] [--preview]`

1. `mode` 为 `none` 时打印「本片 subtitles.mode 为 none，不出字幕」并退出（退出码 0）。
2. 字幕文件不存在：按 3.4 生成并写入，打印条数和检查结果。
3. 字幕文件已存在：不加 `--force` 时不覆盖，只读入并检查，提示「已存在 subtitles.srt（可能手改过断句）；声音返修后要重新生成，请加 --force，会覆盖手改」。加 `--force` 才重新生成。
4. `--preview`：把字幕烧录到小样 `.cache/video-proxy.mp4` 上、配 `.cache/mix.wav`，输出 `<export.name>-proxy-subtitled.mp4`，供审片节点 ⑧ 审阅。不管 `mode` 是 `srt` 还是 `burn` 都烧录（只是审阅用）。小样不存在时报错「先运行 wka render --proxy」。

### 3.7 字幕层：`burnSubtitles(job, video, cues, out)`

- 每条字幕用 Chromium 渲染一张与画面同尺寸的透明 PNG（宿主页 `runtime/subtitle.html`），ffmpeg 用 `overlay=enable='between(t,入点,出点)'` 逐条叠到 `video` 上，`libx264` 重新编码（全分辨率 `-crf 16 -preset medium`，小样 `-crf 23 -preset veryfast`，与镜头编码参数一致），输出 `out`。
- 样式取 `style.json` 新增的可选 `subtitles` 块，缺省值：

| 字段 | 缺省 | 说明 |
|---|---|---|
| `font` | `{ "family": "Noto Sans SC", "fallback": ["PingFang SC", "Noto Sans CJK SC", "sans-serif"] }` | 走 `prepareFonts`，按字幕文字子集化 |
| `size` | 设计高度 × 0.045（1080 → 48.6px） | 按 `designH` 计，小样按比例缩小 |
| `color` | `#FFFFFF` | |
| `stroke` | `{ "color": "rgba(0,0,0,0.65)", "width": 0.08 }` | 宽度为字号的倍数 |
| `bottom` | 0.08 | 文字底边到画面底边的距离，占画面高度的比例 |

- 文字水平居中、多行时行距 1.3 倍；超出画面宽度 90% 的行自动按字号缩小到放得下，并给出警告。
- 字体下载失败时退回 `fallback` 并在日志里写明（与镜头字体一致）。

### 3.8 `wka final` 的变化

- `mode` 为 `burn` / `both`，且本次要导出的格式里有 `mp4`、`gif` 或 `png-seq`：先 `burnSubtitles` 得到 `.cache/video-subtitled.mp4`，再交给这些导出器。只导出 `jianying` 时不烧录。
- `mode` 为 `srt` / `both` 且不是 `--proxy`：把字幕文件复制为 `<export.name>.srt`，日志里列出。
- 字幕文件缺失而 `mode` 不是 `none`：报错「先运行 wka subtitles」。
- `checkSubtitles` 有错误就中断，有警告就打印后继续。
- 剪映草稿：字幕文件存在且 `mode` 不是 `none` 时，`timeline.subtitles` 为解析后的字幕，字幕轨按它生成，不再标「估算」；否则维持现在按人声一句一条的做法。

### 3.9 流程文档里的第 11 道（摘要）

- 前提：⑦ 小样已签批，第 2 道定了字幕方式。
- `mode` 为 `none`（无人声，或客户不要字幕）：停下请客户确认「本片不出字幕」，签批后继续。
- 其余：`wka subtitles` 生成 → 导演检查错字、断句、警告 → `wka subtitles --preview` 出带字幕的小样 → 把 `subtitles.srt` 原文和预览一起交客户，就错字、断句、出入时间、位置（是否压住屏幕文字）征询意见 → 签批 ⑧（`--step 11`）。
- 返修：客户改断句就直接改 `subtitles.srt` 再 `--preview`；声音返修后回到第 11 道 `wka subtitles --force` 重新生成，重新提交 ⑧。
- 已经过了 ⑦ 的在制片子（迁移后在第 11 道之后）要补字幕：在 `film.json` 加 `subtitles`，回到第 11 道走一遍，再重新提交 ⑨ 终审。

## 4. 约束、兼容性与非目标

- 引擎版本 `ENGINE_VERSION` 不变（依赖不变，`wka setup` 不用重跑）；字幕层不进镜头哈希，升级后镜头缓存继续有效。
- 没有 `subtitles` 字段的旧片子行为不变：成片不带字幕，剪映草稿字幕照旧。
- 进度迁移只做 flow 1 → 2；`wka signoff --step` 取 1–14。升级后再用旧编号签批（例如把终审写成 `--step 12`）无法自动识别，靠发版说明提醒。
- 非目标：ASS / VTT 等其他字幕格式；双语字幕；字幕逐字动画；自动检测字幕是否压住屏幕文字（由第 11 道人工审阅）；字幕层缓存（每次烧录都整片重编码）；从音频识别文字（字幕文字只来自 `voices[].text`）。

## 5. 错误处理与运维

| 情况 | 行为 |
|---|---|
| 人声缺同步点 | 报错，提示先运行 `wka soundtrack` |
| srt 格式错误 | 报错，指出第几条 |
| 出点早于入点、超出片长 | 报错中断 |
| 重叠、超长、过短 | 警告，继续 |
| `mode` 非 none 但字幕文件缺失 | `wka final` 报错，提示先运行 `wka subtitles` |
| 小样不存在时 `--preview` | 报错，提示先运行 `wka render --proxy` |
| browser 管线依赖缺失 | 报错，提示运行 `/wukong-animation:setup`（与镜头渲染相同） |
| 字幕字体下载失败 | 退回 fallback 并写日志，不中断 |
| `state.json` 迁移写回失败 | 报错，不吞掉 |

## 6. 验收标准与测试

| # | 验收标准 | 测试 |
|---|---|---|
| A1 | 14 道工序、10 个节点，编号与 3.1 一致；`wka signoff --step 15` 报「取 1–14」 | 单元 `state.test.mjs` |
| A2 | flow 1 的 `step: 12` 迁移为 13，history 中 ≥ 11 的条目加 1 且 gate 改名，`step: 10` 不变，写回 `flow: 2`；flow 2 不再变化 | 单元 `state.test.mjs` |
| A3 | `wka status` 对迁移过的片子提示已换算，显示 N/14 | 单元（`listProductions` 带 `migrated`）+ 手动 |
| A4 | 断句：不超长不拆；按标点合并切分；无标点硬切；时长按字数比例且首尾相接；去结尾标点、保留问号叹号；缺同步点报错 | 单元 `subtitles.test.mjs` |
| A5 | `formatSrt` / `parseSrt` 往返一致；兼容 BOM、CRLF、多行；格式错误报第几条 | 单元 `subtitles.test.mjs` |
| A6 | `checkSubtitles` 能分出错误（倒序、超片长）和警告（重叠、超长、过短） | 单元 `subtitles.test.mjs` |
| A7 | `wka subtitles` 首次生成；已存在时不加 `--force` 不覆盖；`mode: none` 直接退出 | 集成 `subtitles.test.mjs` |
| A8 | 烧录后，字幕时间段内画面底部字幕区域与无字幕版明显不同，时间段外一致 | 集成 `subtitles.test.mjs`（需 browser 依赖，缺失跳过） |
| A9 | `mode: srt` 时 `wka final` 产出 `<name>.srt`、mp4 不带字幕；`mode: burn` 不产出 srt | 集成 `subtitles.test.mjs` |
| A10 | 剪映草稿字幕轨来自 srt：条数、时间、文字与 srt 一致，不标估算 | 单元 `jianying-plan.test.mjs` |
| A11 | 没有 `subtitles` 字段的片子：渲染冒烟测试基准图不变，剪映草稿字幕照旧 | `node tests/smoke/run.mjs` + 现有 jianying 测试 |
| A12 | 流程文档 v1.2.0、SKILL.md、STORYBOARD.md、README 与 3.1 编号一致 | 人工核对 |
