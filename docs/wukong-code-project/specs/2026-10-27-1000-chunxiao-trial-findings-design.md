# 《春晓》试拍问题修正设计

关联 issue：[wukongnotnull/wukong-animation#25](https://github.com/wukongnotnull/wukong-animation/issues/25)

## 1. 问题与目标

用 v0.6.0 完整拍了一支《春晓》（ink-wash，37.5 秒，8 镜，旁白，字幕「两者都要」，交付「成片加剪映草稿」）。v0.6.0 的改动都生效了，但又暴露了 8 个问题，见 issue #25。

目标：下一支片不再出现这 8 处绕路或返工。改动分两类：

- **引擎**（问题 1–5）：声轨这一步不再要求镜头文件；AI 配音可以调语速和音高；`c2d.wash` 默认离屏范围跟随画布变换；`init-project` 更新 `.gitignore` 后自己提交；字幕去掉句中标点。另加一个试听命令，给问题 8 用。
- **director 规则**（问题 6–8）：全程用用户的语言说话；第 14 道不再跑旧的字幕样式补丁；第 6 道先试听音色再签批。写进 `director/SKILL.md` 和 `docs/PRODUCTION-WORKFLOW.md`（升 v1.5.0）。

已核实的事实：

- `wka soundtrack` 调 `loadFilm`，`loadFilm` 逐镜检查 `shots/*.js` 是否存在，不存在就抛错。声轨只用到镜头的 `start` 和 `duration`，用不到镜头文件本身。
- `audio/tts.mjs` 调 edge-tts 时只传 `--voice`，不传 `--rate` 和 `--pitch`。缓存文件名只由引擎、音色、文本决定。`film.schema.json` 的 `voices[]` 设了 `additionalProperties: false`，现在写 `rate` 会校验失败。
- `c2d.wash` 不传 `bounds` 时用 `[0, 0, canvas.width, canvas.height]`，这个范围是在当前变换下的坐标里算的。镜头先 `translate` 再围绕原点画形状时，坐标是负数的那部分落在范围外，就被裁掉。
- `initProject` 只在仓库还没有任何提交时提交 `.gitignore`。已有提交的仓库更新了段落后，`.gitignore` 一直处于未提交状态。`commitSnapshot` 只提交片目录，也不会带上它。
- `buildSubtitles` 只去掉每条字幕结尾的标点。一句人声里有两段（如「春晓。孟浩然。」）合并成一条字幕时，中间的「。」会留下。
- 0.6.0 的剪映导出器（`exporters/jianying/plan.mjs`）已经把字幕样式写进草稿：马善政换成古风小楷，颜色、描边、字号按 `subtitleStyle(ctx.style)`。试拍中导演又跑了一遍《一叶知秋》片目录里的 `style_jianying_subs.py`，还告诉用户「导出的字幕只有文字」。这句话是错的。
- 本机 edge-tts 的中文普通话音色有 6 个：晓晓（女，温暖）、晓伊（女，活泼）、云健（男，激情）、云希（男，阳光）、云夏（男童）、云扬（男，新闻播音）。另有辽宁、陕西两个方言女声。没有老年音色。

## 2. 架构与组件边界

```
loadFilm(filmDir, { requireShots })  core/job.mjs     requireShots: false 时不检查镜头文件
wka soundtrack                       audio/soundtrack.mjs  用 requireShots: false
voices[].rate / pitch                audio/tts.mjs     传给 edge-tts，进缓存文件名
wka audition <片> --voices a,b,c     bin/wka.mjs + audio/tts.mjs  同一句用几个音色合成试听
c2d.wash 默认 bounds                 kits/canvas2d/index.js  画布四角按当前变换反算
initProject                          core/project.mjs  更新段落后单独提交 .gitignore
buildSubtitles                       core/subtitles.mjs  句中标点换成空格
```

- 改动文件：`plugin/engine/core/job.mjs`、`audio/soundtrack.mjs`、`audio/tts.mjs`、`bin/wka.mjs`、`kits/canvas2d/index.js`（以及 `kits/canvas2d/README.md` 的 wash 参数说明）、`core/project.mjs`、`core/subtitles.mjs`、`schemas/film.schema.json`。
- 文档：`plugin/skills/director/SKILL.md`、`docs/PRODUCTION-WORKFLOW.md`。
- 不改：渲染管线、镜头哈希算法、QC、剪映导出器、kokoro 的调用方式（只多一个告警）。

## 3. 接口、数据与行为

### 3.1 声轨不要求镜头文件（问题 1）

- `loadFilm(filmDir, { requireShots = true } = {})`。`requireShots: false` 时跳过镜头文件存在性检查，其余逻辑（校验、算 `start`、`totalDuration`）照旧。
- 只有 `mixSoundtrack` 传 `false`。`still`、`animatic`、`render`、`final`、`qc` 仍然要求镜头文件。镜头文件不存在时报错信息不变。
- `wka init` 生成的 `film.json` 只有 s01。导演在第 7 道加镜头、改时长，不用再复制占位镜头。

### 3.2 AI 配音的语速和音高（问题 2）

`audio.voices[]` 加两个可选字段：

| 字段 | 格式 | 例子 | 说明 |
|---|---|---|---|
| `rate` | `^[+-]\d{1,3}%$` | `"-30%"` | 语速，负数更慢 |
| `pitch` | `^[+-]\d{1,3}Hz$` | `"-4Hz"` | 音高，负数更低 |

- edge-tts 合成时传 `--rate=<rate>`、`--pitch=<pitch>`（写成等号形式，负号开头的值才不会被当成参数名）。
- kokoro 不支持这两个参数：某句写了却走 kokoro 时，打印一次「kokoro 不支持 rate / pitch，已忽略」，照常合成。
- 缓存文件名的哈希加上 `rate` 和 `pitch`：改了语速或音高的句子会重新合成，其余句子照常复用。两个字段都不写的句子哈希不变，已有缓存继续有效。
- 自供录音（`file`）的条目写了 `rate` / `pitch` 时忽略，不报错。
- 句中要停顿时，仍按现在的做法拆成多条 `voices`，用 `at` 控制间隔。本设计不做 SSML 停顿。

### 3.3 试听命令 `wka audition`（问题 8 的引擎部分）

```
wka audition <片目录> [--voices v1,v2,v3] [--text "…"] [--rate -20%] [--pitch -2Hz]
```

- 文本缺省用 `audio.voices` 第一条的 `text`；没有人声条目又没给 `--text` 时报错。
- 音色缺省为 `zh-CN-YunyangNeural,zh-CN-YunjianNeural,zh-CN-XiaoxiaoNeural`；`--voices` 最多 4 个。
- 每个音色输出一个 `review/试听-<n>-<音色短名>.m4a`（`n` 从 1 开始，短名去掉 `zh-CN-` 和 `Neural`，如 `试听-1-Yunyang.m4a`）。每次运行前先删掉 `review/` 下旧的 `试听-*.m4a`。
- 日志每行一个绝对路径，后跟音色全名，导演照抄给用户。
- 只支持 edge-tts（kokoro 的音色名不同，不在本设计内）；没装 edge-tts 时报错，并说明「可以改用自供录音」。
- 试听文件不进 `audio/voice/`，不写 `film.json`，不影响声轨缓存。

### 3.4 `c2d.wash` 的默认离屏范围（问题 3）

- 不传 `bounds` 时，把画布四个角用 `ctx.getTransform().inverse()` 换算到当前坐标系，取外接矩形作为 `bounds`，向外取整。
- 当前变换是单位矩阵时，结果仍是 `[0, 0, cw, ch]`，已有镜头画出来不变。
- 显式传了 `bounds` 的调用不受影响。
- README 的 `o.bounds` 说明改为：「离屏层范围，默认是当前变换下整幅画布覆盖的区域」。
- 积木脚本变了，所有镜头的缓存会失效一次（镜头哈希包含积木脚本），升级后第一次渲染会全量重渲。

### 3.5 `init-project` 提交 `.gitignore`（问题 4）

- 仓库已有提交，且本次改写了 `.gitignore` 段落时：如果改写前 `.gitignore` 相对 `HEAD` 没有未提交的改动（或它还没被跟踪），执行 `git commit -m "wukong-animation: 更新 .gitignore" -- .gitignore`，只提交这一个文件，并打印「已提交 .gitignore」。
- 改写前 `.gitignore` 已有用户自己没提交的改动：不提交，打印「.gitignore 里有你自己没提交的改动，已更新 wukong-animation 段落，请自己提交」。
- 没有 git 身份时沿用现有提示，不提交。
- 仓库还没有任何提交时的逻辑不变（初始提交）。

### 3.6 字幕去掉句中标点（问题 5）

- 每条字幕在去掉结尾标点之后，把句中的 `。，、；：,.;:` 换成一个全角空格 `　`，连续多个只留一个。
- `？！?!…`、书名号、引号保留。
- 例：「春晓。孟浩然。」→「春晓　孟浩然」。
- 只影响 `wka subtitles` 新生成的 `subtitles.srt`。已有 srt 不覆盖（`--force` 才重新生成），和现在一样。

### 3.7 director 规则（问题 6–8）

| 问题 | 规则（写进哪里） |
|---|---|
| 6 中途说明用了英文 | SKILL「对用户说话」第一句加：**全程用用户的语言说话**（用户说中文就用中文），包括工序之间的进度说明、自查说明和交付后的小结；命令、文件名、字段名保持原样 |
| 7 第 14 道多跑旧补丁 | SKILL 第 14 道「交付前自查」加：字幕样式由 `wka final --formats jianying` 写进草稿，导出后不要再跑片目录里的样式补丁脚本（如《一叶知秋》的 `tools/style_jianying_subs.py`）；自查时读草稿 `draft_content.json` 的字幕素材，确认字体、颜色、描边已经写入，再如实告诉用户 |
| 8 定人声前没试听 | SKILL 第 6 道：用户选「AI 配音」后，先 `wka audition`，用 2–3 个候选音色合成文案第一句，把试听文件的绝对路径交给用户，再用一张卡片让用户选音色（选项就是这几个音色，附一句音色特点，可多给一个「都不合适」）。用户要慢读、低沉等效果时，用 `rate` / `pitch` 再试听一轮。选定后才写进 `voices[].voice` 并签批 ④ |
| 8 内置音色不够 | 第 6 道加一张中文音色表（上面 6 个普通话音色及特点），并写明：edge-tts 没有老年音色，硬压音高听起来发怪，不要用；用户要的音色内置没有时，告诉用户可以从外部拿音频，统一按「用户自供录音」接入：剪映的文本朗读、国内云配音平台（需要用户自己注册）、本机开源模型（用前核对许可）、真人录音。模仿某人的声音时，参考录音必须是用户有权使用的 |

`docs/PRODUCTION-WORKFLOW.md` 升 v1.5.0，第 6 道和第 14 道同步这两条，修订记录加一条。SKILL 版本同步到 v1.5.0，命令表加 `wka audition`，`wka soundtrack` 一行补「不要求镜头文件已写好」。

## 4. 不做什么

- 不做 SSML 停顿、逐字时间轴、kokoro 的语速音高。
- 不接入任何云配音平台或开源配音模型的安装。
- 不把动态分镜、接触表、字幕预览移进 `review/`（#24 第 6 条，单独做）。
- 不改接触表的标注方式（ffmpeg 不带 drawtext 的情况，单独做）。
- 不改剪映导出器。

## 5. 测试计划（先写失败的测试）

| 问题 | 测试 | 位置 |
|---|---|---|
| 1 | 只有 s01.js、film.json 有 3 镜时，`loadFilm(dir, { requireShots: false })` 返回 3 镜和正确的 `totalDuration`；不传参数时仍抛「文件不存在」 | `tests/unit/film-compat.test.mjs` |
| 1 | 同样的片子跑 `mixSoundtrack`（无人声、只有 build.mjs）能生成 `mix.wav` | `tests/integration/render.test.mjs` |
| 2 | `voFileName` 带 / 不带 `rate`、`pitch` 时哈希不同；两者都不写时与旧版哈希一致 | `tests/unit/tts-cache.test.mjs` |
| 2 | 用假引擎（`engines` 注入）断言 edge-tts 参数里有 `--rate=-30%`、`--pitch=-4Hz`；kokoro 遇到 rate 只告警一次 | `tests/unit/tts-cache.test.mjs` |
| 2 | schema：`rate: "-30%"` 通过，`rate: "slow"` 报错 | `tests/unit/voice-kind.test.mjs` |
| 3 | 音色短名、输出文件名、旧试听文件清理、缺文本时报错（用假引擎） | `tests/unit/audition.test.mjs`（新建） |
| 4 | `translate(W/2, H/2)` 后围绕原点画一个覆盖整幅画布的多边形，wash 后画布四个角都有墨色；单位矩阵下结果与改前一致 | `tests/integration/render.test.mjs`（Chromium 里渲染一帧取像素） |
| 5 | 已有提交的临时仓库，旧版段落 → `initProject` 后 `git status --porcelain` 为空；`.gitignore` 先有用户未提交改动 → 不提交、打印提示 | `tests/unit/project.test.mjs` |
| 6 | `buildSubtitles` 对「春晓。孟浩然。」得到「春晓　孟浩然」；「何处？春归。」保留问号 | `tests/unit/subtitles.test.mjs` |

文档规则（问题 6–8 的 director 部分）没有自动测试，用下一次试拍验证。

## 6. 验收标准

- A1 `film.json` 有 8 镜、`shots/` 只有 s01.js 时，`wka soundtrack` 成功生成声轨。
- A2 `voices[]` 写 `rate: "-25%"` 后重新 `wka soundtrack`，只有这一句重新合成，时长变长。
- A3 `wka audition films/<片>` 在 `review/` 下生成 3 个试听 m4a，日志打印 3 个绝对路径。
- A4 先 translate 再围绕原点画的 wash 不再被裁成方块；`hanjiang` 示例片渲染结果与改前目视一致。
- A5 在已有提交的项目里运行 `wka init-project` 更新段落后，`git status` 干净。
- A6 「春晓。孟浩然。」生成的字幕是「春晓　孟浩然」。
- A7 SKILL.md 和 PRODUCTION-WORKFLOW.md 写入 3.7 的四条规则，版本 v1.5.0。
- A8 全部测试、smoke、lint、build-docs 检查通过。
