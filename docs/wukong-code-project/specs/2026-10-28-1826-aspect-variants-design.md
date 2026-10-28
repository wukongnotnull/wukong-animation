# 横竖双版：同一套镜头出主版 + 副版画幅 · 设计

关联 issue：#89（来自 #45「横竖双版」一项）

## 1. 问题与目标

- 现在一部片只有一种画幅：`film.json` 的 `size` 在 `wka init --aspect` 时定死（`engine/bin/wka.mjs` `cmdInit`），缓存 `.cache/`、审阅文件 `review/`、字幕 `subtitles.srt`、成片都只有一份。要横屏、竖屏各一版，只能另建一部片、重做声轨和字幕。
- 源 skill wk-motion-graphics 能从同一工程原生重排出竖版，并用逐帧 PSNR 证明横版没变；迁移 keynote 时没带过来。
- 目标：任何声明了两种画幅的风格，都能用**同一套镜头、同一条声轨**，在主版定稿后出一版副版画幅；主版画面有据可查地保持不变；接入 director 的制作流程。

## 2. 架构与组件边界

| 部分 | 负责什么 |
|---|---|
| `film.json` | `size` 仍是主版；新增 `variants` 声明副版 |
| 引擎 `core/` | 解析画幅（主版 / 副版）、按画幅分开缓存和产物路径、找覆盖镜头文件、定稿快照与主版不变比对、副版过期判定、进度编号迁移 |
| 管线 `browser` / `remotion` | 把 `s.aspect`、`s.orientation` 交给镜头；其余不变 |
| 字幕 `core/subtitles.mjs` | 按画幅各拆一份字幕（拆条上限本来就按画幅取） |
| 导出器 `jianying` | 每种画幅各导一份草稿 |
| 风格 | `style.json` 的 `aspects` 声明支持哪些画幅；STYLE.md 写「画幅重排规则」；镜头代码按 `s.aspect` / `s.orientation` 分支 |
| director | 新增第 14 道「改版」与审片节点 ⑫；剪映草稿顺延为第 15 道 / 节点 ⑬ |

主版、副版是相对的：主版画幅按主要投放平台在简报里定，横竖都可以；另一种是副版。

## 3. 接口、数据与行为

### 3.1 `film.json`

```json
{
  "size": [1080, 1920],
  "variants": { "16:9": {} }
}
```

- `size`：主版设计尺寸，含义不变。
- `variants`：键是副版画幅（`"16:9"`、`"9:16"`，数据结构允许多个），值是这一版的覆盖项，缺省为空对象。可覆盖：`subtitles.style`（与 `film.subtitles.style` 同结构）、`export.name`（缺省为主版名加 `-<画幅后缀>`）。
- 副版尺寸由画幅推出：`16:9` → 1920×1080，`9:16` → 1080×1920（与 `cmdInit` 一致）。
- 没有 `variants` = 只出一种画幅，行为与现在完全相同。
- 校验（`wka` 读片时）：副版画幅不能等于主版画幅；副版画幅和主版画幅都必须在风格 `style.json` 的 `aspects` 里，否则报错并列出该风格支持的画幅。
- 两版共用：镜头表（id、顺序、时长）、`cues`、声轨 `mix.wav`。副版不能增删镜头、不能改时长。

### 3.2 画幅后缀

画幅写进文件名时用 `<宽>x<高>`：`16:9` → `16x9`，`9:16` → `9x16`。下文 `<后缀>` 都指这个。

### 3.3 命令行

- `render`、`still`、`animatic`、`qc`、`subtitles`、`final` 加 `--aspect <画幅>`：
  - 不写 = 主版，现有用法和输出都不变。
  - 写副版画幅 = 处理该副版；写的画幅不是主版也不在 `variants` 里时报错。
  - `final --aspect all`：依次出主版和全部副版。
- `wka init --aspect` 含义不变（定主版）。

### 3.4 镜头

- 两条管线给镜头的 `s` 增加 `s.aspect`（`'16:9'` / `'9:16'` / `'1:1'`）和 `s.orientation`（`'landscape'` / `'portrait'` / `'square'`），按当前渲染的设计尺寸算。
- keynote `scripts/shot.tsx` 改为读 `s.orientation`，不再自己比 `designH > designW`。
- 覆盖文件：渲染副版时，若存在 `shots/<镜头文件名>.<后缀>.<扩展名>`（如 `shots/s03.16x9.tsx`、`shots/s03.16x9.js`），用它代替原镜头文件；不需要在 `film.json` 登记。主版永远不用覆盖文件。

### 3.5 路径

主版所有路径不变。副版：

| 东西 | 主版 | 副版（例：16:9） |
|---|---|---|
| 缓存目录 | `.cache/` | `.cache/16x9/`（片段、manifest、work、video、qc.json） |
| 声轨 | `.cache/mix.wav` | 共用主版的 |
| 审阅文件 | `review/小样.mp4`、`review/接触表.jpg`… | `review/小样-16x9.mp4`、`review/接触表-16x9.jpg`… |
| 静帧 | `stills/` | `stills/16x9/` |
| 字幕 | `subtitles.srt` | `subtitles.16x9.srt` |
| 成片 | `<name>_有字幕.mp4` 等 | `<name>-16x9_有字幕.mp4` 等（有无字幕后缀规则照旧） |
| 外挂字幕 | `<name>_字幕.srt` | `<name>-16x9_字幕.srt` |
| 剪映草稿 | `<name>` | `<name>-16x9` |

### 3.6 字幕

- 副版字幕从同一条人声的 cues 生成，拆条上限按副版画幅取（中文横 18 / 竖 12、英文横 45 / 竖 28，即现有 `MAX_CHARS_BY_ASPECT`）；每条出现时间都以人声为准。英文译文沿用主版的，只重新拆条，不重译。
- `wka subtitles --aspect` 的生成 / 检查 / `--force` / `--preview` 行为与主版相同，读写副版的字幕文件。

### 3.7 质检

- 副版质检默认用 `style.json` 的 `qc` 阈值；风格可加可选的 `qc.by_aspect: { "<画幅>": { …覆盖项 } }`，按画幅合并覆盖。

### 3.8 定稿快照与主版不变证明

- 第 13 道签批（`wka signoff … --step 13`）时：
  - 把主版每镜的镜头哈希写进 `.wka/state.json` 的 `approved.main = { <镜头 id>: <哈希> }`（进 git）。
  - 把对应片段复制到 `.cache/approved/`（不进 git）。
- 渲染副版（`render` / `still` / `final` 带 `--aspect`）前，引擎重算主版每镜哈希，与 `approved.main` 比：
  - 哈希相同：该镜通过。
  - 哈希不同：重渲主版该镜，与 `.cache/approved/` 里的快照逐帧比 PSNR，每帧 > 50 dB 算通过；不通过的镜头列出镜头 id 和最低 PSNR。
  - 快照缺失（换机器、清了缓存）：列出这些镜头，提示需目视复核主版。
- 结果写成「主版不变报告」`review/主版不变报告-<后缀>.md`，供节点 ⑫ 提交。有不通过的镜头时，命令照常出副版，但报告置顶写明，director 必须先请用户重新审主版。

### 3.9 副版过期

- 第 14 道签批时，把副版每镜哈希和当时的 `approved.main` 记进 `state.json` 的 `approved.variants.<画幅>`。
- 之后主版再次在第 13 道签批（`approved.main` 变了），所有副版标为过期：`wka status` 提示要重做第 14 道；`wka final --aspect <副版>` / `--aspect all` 拒绝输出过期副版，并说明原因。

### 3.10 工序与进度

| # | 工序 | 审片节点 · `--step` |
|---|---|---|
| 1–13 | 不变 | 不变 |
| 14 | 改版（新增） | ⑫ 改版审片 · `14` |
| 15 | 剪映草稿交付（原第 14 道） | ⑬ 剪映草稿 · `15` |

- `PRODUCTION_STEPS` / `REVIEW_GATES` 照此改；进度流程版本 `FLOW` 从 3 升到 4，`migrateProgress` 把旧进度里第 14 道换成第 15 道，节点标签同步更新。
- 没有 `variants` 的片子：第 13 道签批后，director 执行 `wka signoff <片目录> "无副版，跳过改版" --step 14` 记一笔后直接进第 15 道，不出审片节点。

### 3.11 第 14 道「改版」怎么做（director）

1. 在 `storyboard.md` 末尾加「副版重排」表：每镜一行，写处理方式（沿用 / 按画幅分支 / 覆盖文件）和怎么排。不单独审。
2. 按 STYLE.md 的「画幅重排规则」改镜头代码。
3. `wka still --aspect`、`wka render --proxy --aspect`、`wka qc --proxy --aspect`、`wka subtitles --aspect --preview`。
4. 提交节点 ⑫：副版接触表、带字幕的副版小样、主版不变报告。
5. 签批后 `wka final --aspect <副版>`，再 `wka qc --aspect <副版>`；终版不再单独审。

### 3.12 简报与风格文档

- `director/specs/BRIEF.md` 与 `engine/templates/brief.md`：画幅项改为「主画幅 + 可选副版」；投放平台同时有横屏和竖屏平台时推荐出双版；风格不支持某画幅时不能选它做副版。
- `director/specs/FILM.md`：加 `variants` 字段说明。`director/specs/STORYBOARD.md`：加「副版重排」表格式。
- `new-style` 的风格模板 STYLE.md 加必填段「画幅重排规则」（横转竖、竖转横两个方向）；keynote、ink-wash 补齐这一段。

## 4. 约束、兼容性与非目标

- 兼容：没有 `variants` 的片子行为、路径、缓存、测试基准图都不变；旧进度自动迁移。
- 副版只在主版第 13 道签批之后做；不支持两版同步推进各道工序。
- 副版不能有自己的镜头表、时长、声轨或译文。
- 这次只实现并测试 16:9 ↔ 9:16 两个方向；1:1 在数据结构上允许，但不测试、不在文档里推荐。

## 5. 错误处理与运维

- `--aspect` 值不合法、不在 `variants`、风格不支持：命令立刻失败，提示可用值。
- 副版过期：`final` 失败并说明要重做第 14 道。
- 主版不变比对不通过或快照缺失：不中断，写进报告并在日志里醒目提示。
- PSNR 比对用 ffmpeg 的 `psnr` 滤镜，按镜头逐帧比；只比哈希变了的镜头，控制耗时。

## 6. 验收标准与测试

验收：

1. keynote 示范片《七十二变》（主版 16:9）加 `"variants": { "9:16": {} }`，能出 9:16 副版成片；主版成片与改动前逐帧一致。
2. 改一个镜头的竖屏分支后渲染副版，主版不变报告列出该镜并显示 PSNR 通过。
3. 主版重新签批后，`wka final --aspect 9:16` 拒绝输出，`wka status` 提示重做第 14 道。
4. 旧片子（flow 3）的进度读出后，第 14 道记录变成第 15 道。
5. 没有 `variants` 的片子所有命令输出与现在相同（现有测试与冒烟基准图全过）。

测试（先写，确认失败再实现）：

- 单元：`variants` 解析与校验；画幅后缀与副版路径；覆盖文件查找；`s.aspect` / `s.orientation`；按画幅拆字幕；`qc.by_aspect` 合并；`migrateProgress` flow 3 → 4；主版哈希比对与副版过期判定。
- 集成：《七十二变》渲染 16:9 主版与 9:16 副版；PSNR 比对流程（通过、不通过、快照缺失三种）。
- 冒烟：补 keynote 9:16 的 darwin、linux 基准图。
- `npm run lint`、`npm test`、`npm run smoke` 通过。

## 7. 实施拆分

两个 PR，第二个接在第一个后面：

1. 引擎：3.1–3.10 的引擎部分与对应测试。
2. 流程与风格：director 第 14 / 15 道、3.12 的文档、keynote / ink-wash 画幅重排规则、《七十二变》双版示范与冒烟基准图，以及 ARCHITECTURE、GLOSSARY、CHANGELOG。
