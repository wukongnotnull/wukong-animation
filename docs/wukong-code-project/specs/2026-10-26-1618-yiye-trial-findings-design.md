# 《一叶知秋》试拍问题修正设计

关联 issue：[wukongnotnull/wukong-animation#22](https://github.com/wukongnotnull/wukong-animation/issues/22)

## 1. 问题与目标

用 v0.5.2 从安装到交付完整拍了一支《一叶知秋》（ink-wash，28 秒，旁白 + 对白，字幕「两者都要」，交付「成片加剪映草稿」）。用户打断或返工的地方归纳为 9 个问题，见 issue #22。剪映草稿 id 共用、草稿字幕无样式两处已在 PR #21 修，不在本设计内。

目标：下一支片不再出现这 9 处打断。改动分两类：

- **引擎**（问题 2、7、8）：审阅文件放到不隐藏、能直接播放的位置；片子可以单独覆盖字幕样式；成片文件名标明有没有字幕，「两者都要」同时出无字幕版。
- **director 流程规则**（问题 1、3、4、5、6、9，以及 2、7、8 的用法）：写进 `director/SKILL.md`、`STORYBOARD.md`、`SHOT.md` 和 `docs/PRODUCTION-WORKFLOW.md`（升 v1.4.0），ink-wash `STYLE.md` 补一句留白说明。

已核实的事实：

- `wka soundtrack` 只写 `.cache/mix.wav`（WAV，28 秒约 5.4 MB）。`.cache` 以点开头，访达默认隐藏。
- `wka render --proxy` 输出 `.cache/video-proxy.mp4`，不带声音；试拍时导演手工用 ffmpeg 把它和 `mix.wav` 合成 `review/yiye-proxy-v1.mp4` 交审。
- `wka final` 的成片名是 `<export.name>.mp4`，烧录与否名字一样；`both` 只出烧录版 + srt。
- 字幕样式只从风格 `style.json` 的 `subtitles` 块读（`subtitleStyle(ctx.style)`），片子没有覆盖入口；试拍时导演直接改了插件缓存里的 `ink-wash/style.json`。
- 风格对象不参与镜头哈希（`shotHash` 只算脚本文件、尺寸、种子、时长、字体 CSS、cue），改字幕样式不会让镜头缓存失效。
- 项目 `.gitignore` 的 wukong-animation 段落只在不存在时写入，已有段落不会更新；段落里没有 `review/`，`signoff` 的 `git add -A` 会把 `review/` 下的 m4a 提交进库。

## 2. 架构与组件边界

```
wka soundtrack  ── audio/soundtrack.mjs  混音后另存 review/声轨.m4a
wka render --proxy ── core/job.mjs render()  拼接后有 mix.wav 就合成 review/小样.mp4
wka final       ── bin/wka.mjs cmdFinal  按 subtitles.mode 决定出哪几个版本、怎么命名
                   core/job.mjs encodeOutputs 增加 suffix 参数
loadFilm        ── core/job.mjs  film.json subtitles.style 覆盖风格的 subtitles 块
init-project    ── core/project.mjs  .gitignore 段落加 films/*/review/，旧段落整体替换为新版
```

- 改动文件：`plugin/engine/audio/soundtrack.mjs`、`plugin/engine/core/job.mjs`、`plugin/engine/core/project.mjs`、`plugin/engine/core/subtitle-layer.mjs`（导出合并函数）、`plugin/engine/bin/wka.mjs`、`plugin/engine/schemas/film.schema.json`。
- 文档：`plugin/skills/director/SKILL.md`、`STORYBOARD.md`、`SHOT.md`、`docs/PRODUCTION-WORKFLOW.md`、`plugin/skills/ink-wash/STYLE.md`。
- 不改：镜头渲染管线、镜头哈希、QC 指标与阈值、剪映导出器（PR #21 在改）、mp4 / gif / png-seq 导出器本身。

## 3. 接口、数据与行为

### 3.1 审阅文件目录 `films/<片>/review/`（问题 2）

| 命令 | 新增产物 | 说明 |
|---|---|---|
| `wka soundtrack` | `review/声轨.m4a` | 从 `mix.wav` 转 AAC 192k，体积约为 WAV 的 1/8，聊天和访达里都能流畅播放。没有声轨（不生成 `mix.wav`）时不生成 |
| `wka render --proxy` | `review/小样.mp4` | 小样画面 + `mix.wav`；没有 `mix.wav` 时只复制画面，并提示「小样不带声音」。带 `--only` 时同样重新生成（拼接本来就是整片） |

- 每次生成都覆盖同名文件；历史版本靠签批记录说明，不在文件名里加版本号。
- 这两个产物和已有的 `animatic.mp4`、`stills/sheet.jpg`、`<name>-proxy-subtitled.mp4` 在日志里一律打印**绝对路径**，导演直接转给用户。
- `.gitignore` 段落加一行 `films/*/review/`。`wka init-project` 发现段落已存在但内容不是当前版本时，把 `# >>> wukong-animation >>>` 到 `# <<< wukong-animation <<<` 之间整体替换成当前版本，段落外的内容不动，并打印「已更新 .gitignore」。

### 3.2 片子级字幕样式覆盖（问题 7）

`film.json` 的 `subtitles` 加可选字段 `style`，结构与 `style.json` 的 `subtitles` 块相同（`font`、`size`、`color`、`stroke`、`bottom`）。

- 合并顺序：引擎缺省值 ← 风格 `style.json` 的 `subtitles` ← 片子 `film.json` 的 `subtitles.style`。`font` 整体替换，`stroke` 按字段合并，其余字段直接覆盖。
- 在 `loadFilm` 里合并进 `ctx.style.subtitles`，所以字幕预览、终版烧录、剪映草稿（PR #21 读 `ctx.style`）都用同一份结果。
- schema 照抄 `style.schema.json` 里 `subtitles` 的定义；写错字段时 `loadFilm` 照常报校验错误。

### 3.3 成片命名与版本（问题 8）

`<name>` 为 `export.name`。`subtitles.mode` 决定成片出几个版本：

| mode | 画面类成片（mp4 / gif / png-seq） | 外挂字幕 |
|---|---|---|
| `none` 或没有 `subtitles` | `<name>.mp4`（不变） | — |
| `burn` | `<name>_有字幕.mp4` | — |
| `srt` | `<name>_无字幕.mp4` | `<name>_字幕.srt` |
| `both` | `<name>_有字幕.mp4` + `<name>_无字幕.mp4` | `<name>_字幕.srt` |

- `both` 时 `export.formats` 里的每种画面格式出烧录版；无字幕版只多出一个 mp4。
- `--proxy` 时在后缀后面再加 `-proxy`，如 `<name>_有字幕-proxy.mp4`。
- 剪映草稿（`jianying`）不受影响，仍只导一份。
- `encodeOutputs` 增加可选参数 `suffix`（缺省空串），文件名为 `<name><suffix><-proxy>.<ext>`。

### 3.4 director 流程规则

| 问题 | 规则（写进哪里） |
|---|---|
| 1 签批卡片先于交付物 | SKILL「审片节点的签批卡片」改成固定三步：① 交付物，每个文件一行完整绝对路径（文本类另贴原文）；② 一两句大白话说这是什么、请看哪几点；③ 再弹签批卡片。没交付就不弹卡。签批只用卡片，文字里不写「在下方 / 框里选」之类指向界面的话 |
| 2 文件路径 | 同上第 ①步：只给绝对路径，不加链接、目录、播放命令等额外说明；声轨交 `review/声轨.m4a`，小样交 `review/小样.mp4`（SKILL 第 7、10 道，流程文档同步） |
| 3 术语 | SKILL 新增「对用户说话」一节：用户可能是第一次做动画，术语第一次出现时用一句大白话解释；附 6 个常用术语的一句话解释（文学脚本、分镜、声轨、动态分镜、接触表、小样） |
| 4 景别单一 | SKILL 第 5 道与 `STORYBOARD.md`「景别」栏：4 镜及以上至少用 3 种景别，相邻两镜景别不同（同一幅画「连续」转场的两镜除外，但全片仍要满足至少 3 种）；景别按主体占画面的比例判，不按镜头叫什么；提交分镜时附一行景别序列（如「特写 → 近景 → 远景 → 中景」） |
| 5 画面空 | SKILL 第 8 道自审加两条：每镜至少有主体和环境两个层次（前景 / 中景 / 远景至少两层），主体之外有陪衬；风格规格里的留白、点缀上限是下限 / 上限，不是要贴着的目标。ink-wash `STYLE.md`「计白当黑」后补一句：留白 ≥ 40% 是下限，不是越多越好，画面仍要有前后层次 |
| 6 屏幕文字不同步 | `SHOT.md` 新增「屏幕文字与人声对位」：屏幕文字和某条人声说的是同一句话时，随人声出现，从该人声的 `s.cueIn` 起；逐字写出的，按人声实测停顿（`ffmpeg silencedetect`）或按字数比例把字分配到 `[cueIn, cueOut]`，不用固定字速、不另加延迟；换配音后重新测 |
| 7 字幕样式 | SKILL 第 11 道自审加：字幕字体要和风格搭配（风格没给就提一个开源字体方案）；字幕整体在画面安全框内，文字底边离画面底边不少于画高 5%，且不压住屏幕文字。改样式写 `film.json` 的 `subtitles.style` |
| 7 插件目录 | SKILL「制作规范」加：不改插件安装目录里的任何文件；插件本身的问题记下来，片子交付时告诉用户 |
| 8 成片命名 | SKILL 第 12、13 道写明 3.3 的文件名；`both` 时两个版本都交 |
| 9 剪映草稿 | SKILL 第 14 道：成片定版后，不管简报选了什么，先弹卡片问「要不要导出剪映草稿？」（简报选了要的，「导出」放第一个并标推荐），用户确认要才导出 |

`docs/PRODUCTION-WORKFLOW.md` 升 v1.4.0，修订记录写一行，引用 #22；各道工序表格与正文里涉及的路径、命名同步改。

## 4. 约束、兼容性与非目标

- 只改 `mode` 不为 `none` 的成片文件名；无字幕片子的产物路径不变。
- 已有项目第一次跑新版 `wka init-project` 时 `.gitignore` 段落会被替换；段落外用户自己写的规则不动。
- 非目标：
  - 人声逐字时间的自动提取（需要 TTS 引擎给出字级时间，单独立项）。本次只在 `SHOT.md` 里写测量方法。
  - QC 新增「画面过空」指标：试拍时用户认可的 v2 画面留白仍在 91–98%，按留白设上限会误报，不做。
  - 审阅文件按版本号保留历史。
  - 剪映导出器的任何改动（PR #21）。

## 5. 错误处理与运维

- 生成 `review/声轨.m4a`、`review/小样.mp4` 失败时报错退出，不吞掉 ffmpeg 的错误信息。
- `film.json` 的 `subtitles.style` 字段名或类型不对：`loadFilm` 报「film.json 校验失败」并指出字段，和现有校验一致。

## 6. 验收标准与测试

| # | 验收标准 | 测试 |
|---|---|---|
| A1 | `wka soundtrack` 后存在 `review/声轨.m4a`，是 AAC 音频，时长与 `mix.wav` 一致（±0.1s）；日志打印其绝对路径 | 集成测试（subtitles 测试的小片子） |
| A2 | `wka render --proxy` 后存在 `review/小样.mp4`，含视频和音频两路流 | 集成测试 |
| A3 | `.gitignore` 段落含 `films/*/review/`；旧段落被替换、段落外内容保留；当前版本段落再跑不改文件 | 单元测试（`core/project.mjs`） |
| A4 | 合并顺序缺省 ← 风格 ← 片子，`font` 整体替换、`stroke` 按字段合并 | 单元测试（合并函数） |
| A5 | `film.json` 写了 `subtitles.style.color` 时，烧录出的字幕颜色跟着变 | 集成测试（比较底部像素） |
| A6 | `burn` 只出 `out_有字幕.mp4`，`srt` 出 `out_无字幕.mp4` + `out_字幕.srt`，`both` 三个都有且 `_无字幕` 底部没有字幕 | 集成测试（改写现有 3 个用例 + 新增 both） |
| A7 | 文档规则逐条落到 3.4 表中指定的文件 | `node tools/lint.mjs` 通过 + 人工逐条对照 |
| A8 | 现有单元、集成测试全部通过 | `node --test tests/unit/*.test.mjs tests/integration/*.test.mjs` |
