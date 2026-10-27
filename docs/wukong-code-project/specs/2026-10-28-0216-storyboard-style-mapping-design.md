# 分镜表与风格规格书（STYLE.md）对应关系设计

关联 issue：#49

## 1. 问题与目标

现状（2026-10-28 核实）：

- 分镜表 `director/STORYBOARD.md` 的「技法」栏要求引用 STYLE.md 章节号（如 `§4.5`），但章节号在风格之间不一致：ink-wash 的技法是第 4 节，keynote 在第 3 节插入「字体」后技法变成第 5 节。
- 「转场」栏写死了 ink-wash 的取值（连续 / 墨晕 / 雾遮 / 硬切），keynote 的接缝（`fade` / `hold` / 神奇移动）在分镜规范里没有位置。
- 「屏幕文字」「景别」两栏在风格模板 `templates/style-skill/STYLE.md` 里没有对应章节；keynote 自己加了「字体」，ink-wash 把题字写在技法 4.6；两个风格都没写各景别在本风格里长什么样。
- 风格的「示范片规格」用自己的 4 栏表，和分镜表格式不同；两部示范片目录里都没有 `storyboard.md`。
- `docs/PRODUCTION-WORKFLOW.md` 的「风格库复盘」要把坑写回 STYLE.md 的「常见问题」，但实际上「常见问题」一直在各风格的 SKILL.md（模板 `templates/style-skill/SKILL.md` 也有），文档写错了位置。
- 引擎、工具、测试都不解析分镜表的「技法」栏（只在文档里出现）。

目标：分镜表决定 STYLE.md 必须回答哪些问题，STYLE.md 决定每个问题在本风格里怎么答。STORYBOARD.md 只定栏目和通用规则，不写任何风格自己的取值。

## 2. 架构与组件边界

| 组件 | 改动 |
|---|---|
| `plugin/skills/director/STORYBOARD.md` | 删「技法」栏（11 → 10 栏）；转场栏取值指向风格；时长写成默认值；新增「各栏的风格取值从哪里查」对照表 |
| `plugin/skills/director/templates/film/storyboard.md` | 同步删「技法」栏 |
| `plugin/skills/director/SHOT.md`、`templates/film/shots/s01.js`、`s01.tsx` | 镜头文件开头注释写本镜用到的技法名（STYLE.md 第 5 节的名字） |
| `plugin/skills/director/SKILL.md`、`docs/PRODUCTION-WORKFLOW.md` | 分镜栏目描述改为 10 栏，去掉「技法引用 STYLE.md 章节号」；「风格库复盘」改为写回风格 SKILL.md 的「常见问题」 |
| `templates/style-skill/STYLE.md` | 改为固定的 10 节骨架，每节注明回答分镜的哪一栏 |
| `tools/new-style.mjs`、`plugin/skills/new-style/SKILL.md` | 「九段」说明改为 10 节骨架 |
| `plugin/skills/ink-wash/STYLE.md`、`plugin/skills/keynote/STYLE.md` | 按骨架迁移 |
| `plugin/skills/ink-wash/examples/hanjiang/storyboard.md`、`plugin/skills/keynote/examples/qishier/storyboard.md` | 新增，按分镜格式写；STYLE.md 第 9 节引用它 |
| `tests/unit/style-sections.test.mjs`（新） | 检查每个风格的 STYLE.md 与模板都有 10 个一级章节，名称和顺序一致 |

## 3. 接口、数据与行为

### 3.1 STYLE.md 固定骨架

一级标题固定为下列 10 个，编号与名称一致、顺序不变；风格可以加二级、三级标题，不能增删或改名一级标题。

| 节 | 回答分镜的哪一栏 | 必须包含 |
|---|---|---|
| `## 1. 风格本质` | 总纲 | 风格的核心原则 |
| `## 2. 色彩` | 总纲 | 色表（名称 / 用途 / 值），用量限额 |
| `## 3. 文字` | 屏幕文字 | 字体、字号层级、屏幕文字的出现形式（题字、标题卡、印章……） |
| `## 4. 构图` | 景别、画面 | 构图法则；**景别对照表**（景别 / 本风格里的样子 / 怎么做到），覆盖本风格会用到的景别，至少 3 种 |
| `## 5. 技法` | 镜头文件开头注释 | 有名字的技法清单，三级标题写成 `### <技法名> → <积木>`；镜头文件按名字引用 |
| `## 6. 运动语言` | 运镜 / 动态、时长、转场 | 要 / 不要；**时长**（不写则用 STORYBOARD.md 默认值）；**转场**小节（名称 / 何时用 / 实现，表下写硬切限额） |
| `## 7. 声音` | 音效、声音铺底 | 音效清单与密度上限；配乐 / 环境声的音色、情绪、闪避与响度 |
| `## 8. 禁忌清单` | — | |
| `## 9. 示范片` | — | 链接示范片目录下的 `storyboard.md`，可附一句说明，不再另写一套表 |
| `## 10. 交付前质检` | — | |

现有标题的映射：「风格本质（先读这一段）」保留括号说明，检查时只比对编号和括号前的名称；ink-wash 的「4. 技法」→ 5，「4.6 题字与印章」拆到「3. 文字」（印章仍是技法，文字节写出现形式并指向技法名）；keynote 的「3. 字体」→「3. 文字」；两边的「示范片规格」→「示范片」，「交付前质检」→ 10。「常见问题」留在风格的 SKILL.md，不进 STYLE.md。

### 3.2 分镜表（STORYBOARD.md）

- 栏目：镜 / 段落 / 时长 / 景别 / 画面 / 运镜 / 动态 / 人声 / 音效 / 屏幕文字 / 转场（10 栏）。
- 时长：默认单镜 3–8 秒、动作完成后停至少 1 秒；风格在 STYLE.md 第 6 节写了时长就以风格为准。
- 景别：规则不变（每镜都写；4 镜及以上至少 3 种；相邻两镜不同），`wka signoff --step 5` 照旧检查；各景别的画法查风格第 4 节的景别对照表。
- 转场：取值只能用本风格第 6 节转场表里的名称。
- 新增对照表「各栏在风格里查哪一节」，与 3.1 的表一致。

### 3.3 镜头文件引用技法

镜头文件第一行注释写镜号和本镜用到的技法名，例：`// s02 —— 雾、山石`（ink-wash）、`// s03 —— 镜头取景、高亮框`（keynote）。模板 `s01.js` / `s01.tsx` 的注释改为提示这样写。

### 3.4 机器检查

`tests/unit/style-sections.test.mjs`：

- 读 `templates/style-skill/STYLE.md` 和 `plugin/skills/*/STYLE.md`（存在的才读）。
- 取所有 `## ` 开头的行，去掉括号说明（全角或半角）后，必须恰好等于 3.1 的 10 个标题，顺序一致。
- 失败信息写出文件、缺了哪节、多了哪节或顺序错在哪。

## 4. 约束、兼容性与非目标

- 只改文档、模板和一个单测；不改引擎代码、`film.json` 格式、`wka` 命令行为。
- 已有片子的 `storyboard.md` 里留着「技法」栏不影响任何命令，不做迁移。
- 冒烟测试基准图不受影响（不改镜头代码，只可能改示范片镜头文件的开头注释）。
- 非目标：`wka signoff --step 5` 校验分镜的转场、音效取值是否在风格清单里（需要先把清单写成机器可读格式，以后单独讨论）。
- 非目标：catalog 里尚未建目录的风格。

## 5. 错误处理与运维

- 单测失败即 CI 失败；新风格用 `tools/new-style.mjs` 从模板生成，骨架天然通过。

## 6. 验收标准与测试

1. `node --test tests/unit/*.test.mjs` 全部通过，含新单测；新单测在迁移前对两个现有风格失败。
2. STORYBOARD.md、分镜模板、director/SKILL.md、PRODUCTION-WORKFLOW.md 里不再出现「技法」栏和「引用 STYLE.md 章节号」；`grep -rn "§[0-9]" plugin/skills docs/PRODUCTION-WORKFLOW.md` 无分镜相关残留。
3. STORYBOARD.md 不出现「墨晕」「雾遮」等风格专属取值。
4. 两个风格的 STYLE.md 有景别对照表、转场表；两部示范片各有 `storyboard.md`，按 10 栏格式，景别满足规则，与各自 `film.json` 的镜号、时长、景别一致。
5. `wka init` 生成的片目录里分镜模板是 10 栏，镜头模板开头注释提示写技法名。
