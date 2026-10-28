# brief / story / storyboard：规范与模板分开 · 设计

关联 issue：#70

## 1. 问题与目标

- 三份交付物的模板各只有一份（`plugin/engine/templates/brief.md`、`film/story.md`、`film/storyboard.md`），但它们的**结构**（简报各部分与各项、文学脚本各部分、分镜栏目）在别处又写了几遍：
  - brief：`director/SKILL.md` 第 2 道「简报各项」表、`docs/PRODUCTION-WORKFLOW.md` 总览表第 2 行与「简报包含哪些项」表；
  - story：`SKILL.md` 第 4 道七条说明、PRODUCTION-WORKFLOW 总览表第 4 行与「逐部分写法」表、模板里的括号说明；
  - storyboard：`director/STORYBOARD.md` 的《晨雾》示例代码块、`SKILL.md` 第 5 道栏目清单（还是 #68 之前的旧顺序）、PRODUCTION-WORKFLOW 总览表第 5 行与「逐镜 10 栏」表；`tests/unit/storyboard-columns.test.mjs` 里的 `COLUMNS` 常量又是一份。
- keynote 示范片 `qishier/story.md` 只写到「梗概」，缺「段落结构」「人声文案」「屏幕文字」。
- 目标：**结构只在模板里定义一次**；怎么填写在 director 下的规范文件里，规范文件给出模板路径；其他地方只引用，不再罗列结构。与已有的 `FILM.md` ↔ `film.json`、`SHOT.md` ↔ `shots/` 同一模式。

## 2. 架构与组件边界

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| 模板 | `plugin/engine/templates/brief.md`、`film/story.md`、`film/storyboard.md`（位置不变） | 只放骨架：标题、章节、表头、加粗项。第一行是指向规范的 HTML 注释 `<!-- 写法见 skills/director/<X>.md -->`。不含括号写法说明 |
| 规范 | `plugin/skills/director/BRIEF.md`（新）、`STORY.md`（新）、`STORYBOARD.md`（精简） | 写每一项怎么填、取值、默认值、自查清单；开头写模板路径 `engine/templates/…`（相对插件根目录） |
| 流程 | `plugin/skills/director/SKILL.md` | 只留流程：怎么追问、何时 `wka brief` / `wka init`、提交什么、征询什么、签批、`--force` 规矩。内容规则一句话指向规范文件 |
| 流程文档 | `docs/PRODUCTION-WORKFLOW.md` | 删去罗列章节、项、栏目的地方，改为链接规范文件；保留流程要点 |
| 测试 | `tests/unit/templates-structure.test.mjs`（新，替代 `storyboard-columns.test.mjs`） | 从模板读结构，核对示范片、规范说明表、互相引用的路径；测试里不写结构常量 |

依赖方向不变（#58）：模板仍由引擎复制，`wka init` / `wka brief` 的代码不改。

## 3. 接口、数据与行为

### 3.1 模板

- `brief.md`：删去两行 `>` 说明；保留四个 `##` 部分、各加粗项、「三、制作规格」表。第 2 行起仍是 `# 《<片名>》制作简报`（`wka brief` 替换 `<片名>`）。
- `story.md`：删去全部括号说明；保留基本信息表（表头 `片长 | 画幅 | 风格 | 文学脚本版本`，值留空，版本填 `v1`）、六个 `##` 章节、段落结构表（起 / 承 / 转 / 合四行）、`1. [起]` 人声条目、屏幕文字表。
- `storyboard.md`：删去明文那行「格式见 director/STORYBOARD.md…」，改为首行注释；其余不变。

### 3.2 规范文件

- `BRIEF.md`：开头说明交付物、审片节点 ①、模板路径；「（推断）」标注规则；**推荐答案表**一行一项，「项」列与模板的项逐字相同、顺序相同（含「三、制作规格」表的各行）；字幕方式取值表、交付形式表（从 PRODUCTION-WORKFLOW 移入）；以用户选择为准、故事里没有的人声如何处理。
- `STORY.md`：开头说明交付物、审片节点 ③、模板路径；文学脚本是什么 / 不是什么；**逐部分写法表**，「部分」列为 `基本信息` 加模板的六个 `##` 章节，顺序一致（内容并入现 SKILL.md 第 4 道与 PRODUCTION-WORKFLOW「逐部分写法」表）；示例（《寒江》段落结构）；签批前自查清单。
- `STORYBOARD.md`：开头写模板路径与「样例见各风格 `examples/*/storyboard.md`」；删《晨雾》示例代码块；其余（表头、STYLE.md 对照表、逐镜各栏写法、声音铺底）保留。

### 3.3 SKILL.md

- 第 2 道：保留追问规则与第一轮定片名；「简报各项」表与其后三条内容规则移到 `BRIEF.md`，改为「各项怎么填、推荐答案见 `BRIEF.md`」。
- 第 4 道：七条说明删去，改为「按 `STORY.md` 填 `story.md`」；保留提交完整原文、四点征询、版本号加 1。
- 第 5 道：删去「逐镜标注 10 栏：…」栏目清单与只属于格式的句子，改为「按 `STORYBOARD.md` 写」；保留景别序列附在提交里、`signoff --step 5` 被拒先改分镜。

### 3.4 PRODUCTION-WORKFLOW.md

- 总览表第 2、4、5 行：去掉罗列项 / 部分 / 栏目的条目，改为「按 `BRIEF.md` / `STORY.md` / `STORYBOARD.md`」。
- 第 2 道：「简报包含哪些项」表、字幕方式表、交付形式表删去，链接 `BRIEF.md`。
- 第 4 道：「逐部分写法」表、示例、自查清单删去，链接 `STORY.md`；保留输入、产出、提交审阅、返修。
- 第 5 道：表头说明与「逐镜 10 栏」表删去，链接 `STORYBOARD.md`。

### 3.5 示范片

- `keynote/examples/qishier/story.md` 按这支 14 秒片已有的 `storyboard.md` / `film.json` 补「段落结构」「人声文案」「屏幕文字」三节。

## 4. 约束、兼容性与非目标

- 不改引擎代码与模板位置；`wka brief` 生成的 `brief.md` 仍含《片名》标题。
- 规范与 SKILL.md 里的路径相对插件根目录写（`engine/templates/…`、`skills/director/…`），不以 `templates/` 开头（`tools/lint.mjs` 分发边界规则）。
- 非目标：不改 FILM.md / SHOT.md；不改其他示范片内容（只在测试发现结构不一致时修正）；不改 STYLE.md 章节。

## 5. 错误处理与运维

- 纯文档与测试改动，无运行时错误路径。结构漂移由新测试在 `npm test` 中报出。

## 6. 验收标准与测试

| # | 标准 | 验证 |
| --- | --- | --- |
| A1 | 三个模板首行是指向存在的规范文件的注释，模板里没有括号写法说明和 `>` 说明行 | 新测试 |
| A2 | 三份规范文件都写了存在的模板路径 | 新测试 |
| A3 | 每部示范片的 brief / story / storyboard 结构（`##` 章节、加粗项、表头）与模板一致 | 新测试 |
| A4 | `BRIEF.md` 推荐答案表的项、`STORY.md` 逐部分写法表的部分、`STORYBOARD.md` 逐镜各栏写法表的栏，顺序与模板一致 | 新测试 |
| A5 | 测试文件里不出现结构常量（栏目名、章节名列表） | 审阅 |
| A6 | SKILL.md、PRODUCTION-WORKFLOW.md 不再罗列简报项、文学脚本部分、分镜栏目 | `grep` 审阅 |
| A7 | lint、全部单元与集成测试通过 | `npm run lint`、`npm test` |
