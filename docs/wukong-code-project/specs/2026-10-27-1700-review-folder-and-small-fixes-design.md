# 审阅文件归入 review/、字幕小数点断句、试听音色简称、zsh 命令写法

关联 issue：[wukongnotnull/wukong-animation#28](https://github.com/wukongnotnull/wukong-animation/issues/28)（含 [#24](https://github.com/wukongnotnull/wukong-animation/issues/24) 第 6 条）

## 1. 问题与目标

1. **审阅文件不全在 `review/`**：声轨、小样、试听已经在 `review/`，但交给用户的另外三样还散在各处：动态分镜 `animatic.mp4`（片目录根）、接触表 `stills/sheet.jpg`、字幕预览 `<name>-proxy-subtitled.mp4`（片目录根）。
2. **长字幕在小数点处断开**：`clauses()` 遇到 `.` `,` 就切，`3.5`、`1,000` 也会被切成两段。
3. **试听只认音色全名**：`--voices` 要写 `zh-CN-YunyangNeural`。
4. **zsh 里把引擎命令存进变量会失败**：`W="node …/wka.mjs"; $W check` 在 zsh 里不按空格拆分，整串被当成一个文件名。

目标：交给用户的审阅文件都在 `review/`，都用中文文件名；数字里的标点不断句；试听可以写中文名或简称；director 写明用 shell 函数调用引擎。

已核实的事实：

- `core/job.mjs` 的 `animatic()` 写 `<片>/animatic.mp4`；接触表由 `stills()` 写到 `stills/sheet.jpg`。`wka still` 和 `wka animatic` 都会生成接触表：第 8 道交给用户的是 `animatic` 生成的那张；第 10 道导演自审小样用 `wka still --frames 4 --proxy`，那张只给导演自己看。
- `bin/wka.mjs` 的 `cmdSubtitles` 写 `<片>/<name>-proxy-subtitled.mp4`，日志打印绝对路径。`tests/integration/subtitles.test.mjs` 断言了这个文件名。
- `.gitignore` 段落已经忽略 `films/*/review/`，新位置不会被提交。
- `core/job.mjs` 已有 `writeReview(filmDir, file, args)`，用 ffmpeg 把产物写进 `review/` 并返回绝对路径。

## 2. 架构与组件边界

```
wka animatic        core/job.mjs animatic()   输出 review/动态分镜.mp4，接触表另存 review/接触表.jpg
wka still           core/job.mjs stills()     不变，仍写 stills/sheet.jpg（导演自审用）
wka subtitles --preview  bin/wka.mjs cmdSubtitles  输出 review/字幕预览.mp4
字幕断句            core/subtitles.mjs clauses()  数字之间的 . , 不断句
wka audition --voices    audio/audition.mjs resolveVoice()  全名 / 中文名 / 简称
director            SKILL.md「引擎命令」  zsh 用函数
```

- 改动文件：`plugin/engine/core/job.mjs`、`plugin/engine/bin/wka.mjs`、`plugin/engine/core/subtitles.mjs`、`plugin/engine/audio/audition.mjs`。
- 文档：`plugin/skills/director/SKILL.md`、`docs/PRODUCTION-WORKFLOW.md`（升 v1.5.2）、`README.md`（「成片在哪里」一节的 `review/` 说明）。
- 不改：静帧渲染、QC 接触表（`stills/qc/qc-sheet.jpg` 只给导演看）、接触表在 ffmpeg 不带 drawtext 时没有标注的问题。

## 3. 接口、数据与行为

### 3.1 审阅文件都进 `review/`（问题 1）

| 命令 | 原来 | 现在 |
|---|---|---|
| `wka animatic` | `animatic.mp4` | `review/动态分镜.mp4` |
| `wka animatic` 的接触表 | `stills/sheet.jpg` | `stills/sheet.jpg` 照旧生成，另复制一份到 `review/接触表.jpg` |
| `wka subtitles --preview` | `<name>-proxy-subtitled.mp4` | `review/字幕预览.mp4` |
| `wka still` | `stills/sheet.jpg` | 不变（导演自审用，不交给用户） |

- 日志照旧打印绝对路径：`接触表：…/review/接触表.jpg`、`动态分镜：…/review/动态分镜.mp4`、`字幕预览：…/review/字幕预览.mp4`。
- 每次生成都覆盖同名文件。
- 片目录里旧的 `animatic.mp4`、`<name>-proxy-subtitled.mp4` 不删，以后也不再更新。
- `animatic()` 的返回值 `file`、`contactSheet` 改成新路径。

### 3.2 数字里的标点不断句（问题 2）

`clauses()` 遇到 `.` 或 `,` 时，如果前一个字符和后一个字符都是数字（`0-9`），就不在这里断开。全角标点和其他 ASCII 标点照旧。

- `增长了3.5亿，达到1,000万人次，创下新高` 在 `maxChars` 为 10 时切成「增长了3.5亿」「达到1,000万人次」「创下新高」，不再从「3.」处切开。
- 3.6 节的显示规则（#25 里加的）不变：数字里的 `.` `,` 本来就保留。

### 3.3 试听音色可以写中文名或简称（问题 3）

`--voices` 里每一项按顺序解析：

1. 形如 `xx-XX-…Neural` 的全名：原样使用。
2. 中文名：查表。表里有 8 个：云扬 `zh-CN-YunyangNeural`、云健 `zh-CN-YunjianNeural`、云希 `zh-CN-YunxiNeural`、云夏 `zh-CN-YunxiaNeural`、晓晓 `zh-CN-XiaoxiaoNeural`、晓伊 `zh-CN-XiaoyiNeural`、晓北 `zh-CN-liaoning-XiaobeiNeural`、晓妮 `zh-CN-shaanxi-XiaoniNeural`。
3. 拉丁字母简称（如 `Yunyang`、`liaoning-Xiaobei`）：补成 `zh-CN-<简称>Neural`。
4. 其他（不在表里的中文名等）：报错，并列出表里的 8 个中文名。

- 日志和试听文件名照旧用全名和短名（`试听-1-Yunyang.m4a  zh-CN-YunyangNeural`），导演把日志里的全名写进 `voices[].voice`。
- `film.json` 的 `voices[].voice` 仍只认全名，不做解析（AI 配音直接传给 edge-tts）。

### 3.4 director：zsh 里用函数调用引擎（问题 4）

SKILL「引擎命令」一节，在 `wka` 的定义下面加：

> 在 shell 里先定义一个函数再调用：`wka() { node "<插件根目录>/engine/bin/wka.mjs" "$@"; }`。不要把整条命令存进变量再 `$W check`：zsh 不按空格拆分变量，会报「no such file or directory」。每条 Bash 命令都是新的 shell，函数要在同一条命令里先定义。

## 4. 不做什么

- 不删除或迁移旧位置的 `animatic.mp4`、`<name>-proxy-subtitled.mp4`。
- 不改 `wka still` 和 QC 接触表的位置。
- 不做接触表在 ffmpeg 不带 drawtext 时的标注（另做）。
- `voices[].voice` 不支持中文名或简称。

## 5. 测试计划（先写失败的测试）

| 问题 | 测试 | 位置 |
|---|---|---|
| 1 | `wka animatic` 后 `review/动态分镜.mp4` 和 `review/接触表.jpg` 存在，日志打印这两个绝对路径；片目录根上没有新生成的 `animatic.mp4` | `tests/integration/render.test.mjs` |
| 1 | `wka subtitles --preview` 输出 `review/字幕预览.mp4`（改现有断言） | `tests/integration/subtitles.test.mjs` |
| 2 | 上面 3.2 的例子切成三条；`3.5` 和 `1,000` 不被切开 | `tests/unit/subtitles.test.mjs` |
| 3 | `resolveVoice`：全名原样、`云扬` → 全名、`Yunyang` → 全名、`liaoning-Xiaobei` → 全名、`老张` 报错并列出中文名；`auditionVoices` 用 `['云扬', 'Yunjian']` 时合成调用拿到的是全名 | `tests/unit/audition.test.mjs` |

文档规则（问题 4）没有自动测试。

## 6. 验收标准

- A1 `wka animatic films/<片>` 后，`review/` 里有 `动态分镜.mp4` 和 `接触表.jpg`，日志打印绝对路径。
- A2 `wka subtitles films/<片> --preview` 生成 `review/字幕预览.mp4`。
- A3 `wka audition films/<片> --voices 云扬,晓晓` 生成两个试听文件。
- A4 含 `3.5` 的长字幕不在小数点处断开。
- A5 SKILL.md、PRODUCTION-WORKFLOW.md、README.md 里提到这三样审阅文件的地方都改成 `review/` 下的新名字；SKILL 写明 zsh 用函数；流程文档升 v1.5.2。
- A6 全部测试、smoke、lint、build-docs 检查通过。
