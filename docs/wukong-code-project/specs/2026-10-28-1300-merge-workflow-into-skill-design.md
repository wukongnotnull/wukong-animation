# 流程文档并入 director/SKILL.md · 设计

关联 issue：#75

## 1. 问题与目标

- 制作流程写了两份：`docs/PRODUCTION-WORKFLOW.md`（381 行，约 46 KB，给人看，不随插件分发）和 `plugin/skills/director/SKILL.md`（285 行，约 33 KB，导演技能每次启动整份读进上下文）。两份约六成重复（工序细则、提交审阅、选择卡片、返修流程），改流程要改两处。
- 目标：**SKILL.md 成为唯一的流程文档**，删除 PRODUCTION-WORKFLOW.md。按读者分流，不原样全搬：做片要用的并进 SKILL.md；按需查阅的术语表、只给维护者看的修订记录与提案放进 `director/references/`。

## 2. 架构与组件边界

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| 流程 | `plugin/skills/director/SKILL.md` | 唯一的流程文档：14 道工序、11 个审片节点、提交与交互规则、返修流程与流程图 |
| 填写规范 | `plugin/skills/director/specs/`（不变） | 各交付文件怎么写 |
| 术语表 | `plugin/skills/director/references/GLOSSARY.md`（新） | 全部术语解释，导演对用户第一次说某个术语时查 |
| 修订记录 | `plugin/skills/director/references/CHANGELOG.md`（新） | 改流程的规矩、修订记录、未采纳的提案；导演做片时不读 |

## 3. 接口、数据与行为

### 3.1 GLOSSARY.md

- 搬入 PRODUCTION-WORKFLOW「术语解释」全表（列：术语 / 解释 / 本流程中），内容不变。
- SKILL.md「对用户说话」里 6 条（文学脚本、分镜、声轨、动态分镜、接触表、小样）的大白话说法并入：对应术语的「解释」改用这些说法；表中没有的术语（声轨）新增一行。
- SKILL.md 删去这张小表，改为一句：术语第一次出现时用一句话解释，说法见 `references/GLOSSARY.md`。

### 3.2 CHANGELOG.md

1. 开头：流程变更由项目负责人（插件维护者）决定；改 `SKILL.md` 时升流程版本号并在本文件记一条。
2. 修订记录：PRODUCTION-WORKFLOW 第 6–19 行的 14 条，按版本号倒序；无版本号的那条（2026-10-26，第 4 道更名）排在 v1.1.0 之下。最上面新增一条：v1.9.0（2026-10-28）流程文档并入 SKILL.md，术语表与修订记录移到 `references/`，工序与节点不变（#75）。
3. 「未采纳的提案」：PRODUCTION-WORKFLOW「待议变更」6 条，原样。

### 3.3 SKILL.md

- 第 8 行：`制作流程版本 **v1.9.0**（修订记录见 references/CHANGELOG.md）`。
- 第 11 道：并入断句规则表（含 `max_chars` 缺省横屏 18、竖屏 12、方形 14）；加一句：放在 ⑧ 小样签批之后，文字、时间、构图都已定下，断句和位置不会再被画面返修打乱，且在终版渲染之前，烧录字幕能随终版一起出。
- 第 12 道：成片命名改为表（`none` / `burn` / `srt` / `both` → 成片 / 外挂字幕），替换现有长句。
- 第 14 道：加一句为什么放在终审之后（草稿不在片目录、git 管不到，用户在剪映里的改动 wka 也管不到）；剪映草稿默认目录 `~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft`；`pip install pyJianYingDraft==0.3.1`；草稿轨道表（视频 / 人声 / 配乐·环境声·音效 / 字幕）。
- 「返修流程」一节末尾加流程图与图例（自 PRODUCTION-WORKFLOW「流程图」）。
- 不搬：流程总览表（与逐道细则重复）、角色表（SKILL.md 已有导演 / 用户的意思；项目负责人的规矩进 CHANGELOG）、各处 `wka signoff` 示例。

### 3.4 其他

- 删除 `docs/PRODUCTION-WORKFLOW.md`。
- `README.md` 第 160 行链接改指 `plugin/skills/director/SKILL.md`。
- `docs/wukong-code-project/` 下历史 spec 与计划保持原样。

## 4. 约束、兼容性与非目标

- 不改工序、审片节点、命令与引擎行为；流程版本不升。
- `references/` 下的文件不得让用户运行 `node tools/…`、不引用根目录 `templates/`（`tools/lint.mjs` 分发边界规则）。
- 非目标：不重写 SKILL.md 其余段落；不改 specs/。

## 5. 错误处理与运维

纯文档改动，无运行时错误路径。

## 6. 验收标准与测试

| # | 标准 | 验证 |
| --- | --- | --- |
| A1 | `docs/PRODUCTION-WORKFLOW.md` 不存在；除 `docs/wukong-code-project/` 外无引用 | `git grep PRODUCTION-WORKFLOW` |
| A2 | `references/GLOSSARY.md` 含原术语表全部术语，并含 SKILL.md 原 6 条；SKILL.md 不再有术语小表 | 审阅、`grep` |
| A3 | `references/CHANGELOG.md` 含规矩、15 条修订（按版本号倒序）、6 条未采纳提案 | 审阅 |
| A4 | SKILL.md 含 3.3 列出的各项 | 审阅 |
| A5 | lint、全部单元与集成测试通过 | `npm run lint`、`npm test` |
