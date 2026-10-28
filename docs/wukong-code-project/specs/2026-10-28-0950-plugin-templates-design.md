# 模板收进插件 · `wka new style` 设计

关联 issue：#58

## 1. 问题与目标

- 插件只分发 `plugin/`（`.claude-plugin/marketplace.json` 的 `source` 是 `./plugin`）。但 `plugin/skills/new-style/SKILL.md` 第 26、28 行让用户跑 `node tools/new-kit.mjs`、"从插件的 `templates/style-skill/` 复制"——这两个路径都在仓库根目录，用户装好插件后找不到，**这个技能装出去是坏的**。
- `wka init` 读 `plugin/skills/director/templates/film/`，`wka brief` 读 `plugin/skills/director/templates/brief.md`：引擎反过来依赖某个技能的目录。
- `tools/scaffold.mjs` 的 `args()` 与引擎 `bin/args.mjs` 的 `parseArgs()` 重复。
- 目标：用户侧需要的模板与生成命令全部随插件分发；依赖方向为"技能 → `wka` 命令行 → 引擎"；维护脚本复用引擎代码。

## 2. 架构与组件边界

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| 模板目录 | `plugin/engine/templates/`（新） | `film/`（自 `skills/director/templates/film/` 移入）、`brief.md`（自 `skills/director/templates/brief.md` 移入）、`style-skill/`（自根目录 `templates/style-skill/` 移入）。三类插槽的 `_template/` 留在各自插槽里不动 |
| 路径常量 | `core/paths.mjs` 新增 `TEMPLATES_DIR` | 引擎里取模板只经过它 |
| 复制模板 | `core/scaffold.mjs`（新，自 `tools/scaffold.mjs` 移入） | `copyTemplate(src, dest, vars)`、`NAME_RE`，行为不变 |
| 命令 | `bin/wka.mjs` 新增 `wka new style` | 从 `templates/style-skill/` 生成一个风格目录 |
| 维护脚本 | `tools/new-style.mjs`、`tools/new-kit.mjs`、`tools/new-pipeline.mjs` | 改用引擎的 `parseArgs` 与 `core/scaffold.mjs`；`tools/scaffold.mjs` 删除 |
| 分发边界检查 | `tools/lint.mjs` | 新增一条：`plugin/skills/`、`plugin/commands/` 下的 `.md` 不得让用户运行 `node tools/…`，也不得引用根目录 `templates/`（kit README 里"由 `node tools/build-docs.mjs` 生成"的说明、片子目录里的 `tools/` 不算） |

`new-kit` / `new-pipeline` **不**开放给用户：插槽在 `plugin/engine/` 里，用户加进去的会在插件升级时被覆盖。

## 3. 接口、数据与行为

### 3.1 `wka new style`

```
wka new style <id> --name <名称> [--category <分类>] [--order <N>] [--dest <目录>]
```

- `<id>` 须匹配 `NAME_RE`，`--name` 必填；缺少或不合法时退出码非 0，打印用法。
- 默认值：`--category custom`、`--order 101`、`--dest ~/.wukong-animation/styles`（即 `USER_STYLES_DIR`，受 `WUKONG_ANIMATION_HOME` 覆盖）。
- 风格模板 `style.json` 里的 `"qa"` 改为 schema 认可的 `"qc"`（实现中发现：原模板生成的风格过不了校验，会被 `getStyles()` 丢弃，A4 因此失败）。
- 生成 `<dest>/<id>/`，占位符替换与现在 `tools/new-style.mjs` 相同：`ID`、`NAME`、`CATEGORY`、`ORDER`、`GLOBAL`（id 转驼峰）、`ONE_LINE`、`WHEN`。
- 目标目录已存在：退出码非 0，不覆盖任何文件。
- `<dest>` 不存在时自动创建。
- 成功后打印目录与下一步（写 STYLE.md 十节 → TECH.md → scripts/ → 示范片 → `wka list styles` 校验）。
- `wka new` 后跟 `style` 以外的类别：退出码非 0，提示只支持 `style`。
- `bin/args.mjs` 的 `VALUE_OPTS` 增加 `name|category|order|dest`。

### 3.2 `wka init` / `wka brief`

只改模板来源为 `TEMPLATES_DIR`，产出与现在逐字节相同（现有 `init-template.test.mjs` 不改断言即可通过）。

### 3.3 `tools/new-style.mjs`（维护者）

```
node tools/new-style.mjs <id> --name <名称> --category <分类> [--order N] [--dest 目录]
```

- 序号：`--order` 优先；否则 `plan72.json` 里有该 id 时取规划序号；否则 `plan.styles.length + 1`（与现在一致）。
- 以子进程调用 `wka new style <id> --name … --category … --order … --dest <dest>`，`--dest` 默认 `plugin/skills`；退出码透传。
- 去掉原 `--user` 开关（用户自建风格改用 `wka new style`）。

### 3.4 `tools/new-kit.mjs` / `tools/new-pipeline.mjs`

参数与行为不变，只把解析换成 `parseArgs`（`VALUE_OPTS` 增加 `desc|ext`）、复制换成 `core/scaffold.mjs`。

### 3.5 文档

- `new-style/SKILL.md`：第 3 步改为 `wka new style <id> --name <名称>`；"规划中"的工具包改为"告诉用户需要在仓库里实现，提 issue 或 PR"，不再出现 `tools/`。
- `docs/ARCHITECTURE.md` 仓库结构图、`docs/CONTRIBUTING.md`（命令示例、`--user` 说明）、`docs/PRODUCTION-WORKFLOW.md`（3 处模板路径）同步新路径。
- `bin/wka.mjs` 文件头用法注释加 `wka new style`。

### 3.6 版本

`plugin/.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json`（两处）0.10.0 → 0.11.0；`plugin/engine/package.json` 0.1.0 → 0.2.0。`package-lock.json` 里引擎自身版本随之更新。

## 4. 约束、兼容性与非目标

- 已建好的片子和用户风格不受影响：模板只在新建时读取。
- 引擎版本变化会让 `DEPS_DIR`（`deps/<引擎版本>/`）换目录，用户升级后需重新 `wka setup`（与以往升级引擎版本时相同）。
- 非目标：风格模板 `style.json` 里 `$schema` 的相对路径在用户目录下无法解析（现有问题，不在本次范围）；根目录 `package.json`、CI 入口（第 2 个 PR）；画廊与文档说明（第 3 个 PR）。

## 5. 错误处理

- 参数缺失 / id 不合法 / 目标已存在 / 未知类别：`fail()` 打印中文原因与用法，退出码 1，不留下半成品目录（检查在复制之前完成）。

## 6. 验收标准与测试

| # | 验收标准 | 测试 |
| --- | --- | --- |
| A1 | `wka new style foo --name 测试` 在 `$WUKONG_ANIMATION_HOME/styles/foo/` 生成 SKILL.md、STYLE.md、TECH.md、style.json、scripts/style.js，且不残留 `__XXX__` 占位符；style.json 的 `category` 为 `custom`、`order` 为 101 | `tests/integration/new-style.test.mjs`（新） |
| A2 | `--dest`、`--category`、`--order` 生效 | 同上 |
| A3 | 目标已存在、缺 `--name`、id 不合法、`wka new kit`：退出码非 0，目录内容不变 | 同上 |
| A4 | 新生成的用户风格出现在 `wka list styles` 中 | 同上 |
| A5 | `tools/new-style.mjs` 按 `plan72.json` 取序号，写到 `--dest` | 同上 |
| A6 | `wka init` / `wka brief` 产出不变 | 现有 `init-template.test.mjs`、`brief.test.mjs` |
| A7 | `plugin/skills/`、`plugin/commands/` 下的 `.md` 不让用户运行 `node tools/…`、不引用根目录 `templates/` | `node tools/lint.mjs` 新规则 |
| A8 | `tools/scaffold.mjs` 与根目录 `templates/` 不再存在；全部单元、集成测试和冒烟测试通过 | `node --test tests/unit/*.test.mjs tests/integration/*.test.mjs`、`node tests/smoke/run.mjs` |

`style-sections.test.mjs`、`score-tracks.test.mjs` 里写死的模板路径随之更新。
