# 可移植技能分发与安装生命周期

状态：待审；日期：2026-10-29；对应已批准 PRD FR-9/10/11/14；跟踪 [#98](https://github.com/wukongnotnull/wukong-animation/issues/98)。本文是具体设计提案，尚未批准实施。

## 1. 问题与目标

现有技能通过自身位置上移两级寻找引擎，孤立复制会丢失资源。原生插件内的 film/setup 等名称不能直接铺到公共技能目录。目标是保留原生插件，同时提供一个完整、可移动、无需符号链接的 `wukong-animation` 技能包及跨平台生命周期工具。需求依据为已确认 PRD；资源关系已核对 `core/paths.mjs`、film/setup/styles 入口及 desktop-plugin 测试。

## 2. 架构与组件边界

- `plugin/` 继续是引擎、目录、风格、制作规则的唯一编辑源；现有 marketplace 和原生命令保持原协议。
- 新增 `distribution/portable/SKILL.md`，只负责 setup、浏览风格、开拍、继续制作和自定义风格的意图路由，不复制导演规则。frontmatter 名称为 `wukong-animation`，描述不超过标准的 1024 字符。
- 新增构建器 `tools/build-portable.mjs`，输出 `dist/wukong-animation/`。输出根含 SKILL.md、engine/、skills/、catalog.json、许可证、`bundle.json`。按明确文件清单生成，保留引擎相对于风格和 catalog 的原有关系。
- 为避免递归发现多个通用技能，打包时将原生 `skills/*/SKILL.md` 转成同目录 `INSTRUCTIONS.md`，并用确定性映射重写这些文档之间的引用；资源、模板和脚本保持原相对位置。源码不改名，不用盲目全局字符串替换。打包校验所有指令链接闭合，包内只有根 SKILL.md。自定义风格在 portable 模式下也输出 INSTRUCTIONS.md，原生模式继续 SKILL.md；两种模式共享同一创建实现。
- 新增 `tools/install-agent.mjs`，使用 Node.js 20+ 标准库安装，不依赖 Git、bash、管理员权限、软链接或各家 CLI。新建声明式 `distribution/agents.json` 管理路径与证据，契约见宿主 spec。
- 第一方正式分发为 GitHub Release 的 `wukong-animation-agent-skills-v<version>.zip`：包含 `wukong-animation/`、独立安装器、profiles 和校验清单。用户解压后运行安装器；源码副本可先构建再安装。此次不引入 npm 发布账户或远程脚本管道执行。
- 通用第三方安装器仅作为补充：它必须复制完整生成目录并通过同一契约测试后才写入教程。主渠道不依赖它如何扫描本仓库，也不承诺 `npx skills add <repo>` 已可用。

## 3. 接口、数据与行为

### 命令接口

在发布包解压目录执行，以下为待实现接口：

```text
node install-agent.mjs list [--json]
node install-agent.mjs install --agent <id> --scope project --project <absolute-path> [--dry-run] [--json]
node install-agent.mjs install --agent <id> --scope global [--dry-run] [--json]
node install-agent.mjs status --agent <id> --scope <project|global> [--project <absolute-path>] [--json]
node install-agent.mjs upgrade --agent <id> --scope <project|global> [--project <absolute-path>] [--dry-run] [--json]
node install-agent.mjs uninstall --agent <id> --scope <project|global> [--project <absolute-path>] [--dry-run] [--json]
```

源码命令使用 `node tools/install-agent.mjs`，显式 `--bundle <absolute-path>` 指向构建输出；发布包默认同级 wukong-animation。安装器不在线拉取浮动 latest；升级使用用户下载的新版本包，同版本同内容安装幂等。降级拒绝并提示使用原版本发布包和另行确认的迁移流程，不自动执行。每次写入前输出绝对目标、版本、作用域与动作；dry-run 无任何写入。未给 agent/scope 不猜测批量安装。原生专用渠道在 list 中给原生说明，不伪造复制成功。

目标为 profile 指定目录下的 `wukong-animation/`。运行指令从实际加载的根 SKILL.md 位置定位目录，再进入 engine/bin/wka.mjs；禁止从 cwd 或开发机绝对路径推断插件根。作品仍写入用户明确选择的工作目录，依赖仍用现有 `WUKONG_ANIMATION_HOME`/deps 规则，不写进发布目录。

`bundle.json` 使用 schemaVersion=1，记录 pluginVersion、engineVersion、sourceCommit、entry、每个普通文件的相对路径及 SHA-256。插件版本来自 plugin/plugin.json，engineVersion 独立读取，禁止将现有 engine 0.2.0 跟随插件号强改。相同输入产生相同文件清单和摘要；ZIP 条目时间与顺序固定。

安装副本增加 `.wukong-install.json`，记录 schemaVersion、安装器版本、pluginVersion、sourceCommit、作用域、规范化目标、所有已管理文件摘要和请求此目标的 agent IDs。状态输出包括 missing/current/modified/conflict/unsupported、实装版本、目标、资源检查结果；该状态不代表宿主已发现或完成渲染。外部安装的无收据包可读取版本，但不会自动接管。

共享路径按规范化真实父目录去重。例如几个工具都使用 `.agents/skills` 时，增加 owner ID 不重写文件；卸载一个 owner 保留其他 owner 的包，最后一个才删除。原生插件和 portable 副本同时存在时明确提示版本及禁用重复入口的方法，不擅自修改宿主启用配置。

## 4. 约束、兼容性与非目标

支持 macOS/Linux/Windows 的 Node 路径语义，所有外部进程参数使用参数数组；中文、空格、#、% 不作为 shell 代码。global 根用 os.homedir()，仅 profile 明确声明时支持对应配置目录环境变量；测试注入临时 home，不碰真实用户目录。项目根必须已存在且为明确绝对目录。Windows 不为安装建 junction。

仅打包运行所需代码、锁文件、技能指令、风格/模板/必要示例和许可证；排除 node_modules、依赖缓存、.git、测试、维护文档、客户作品和渲染成片。自定义资源不允许从包外链接补齐。生成物不人工编辑、不在源码维护第二份引擎；随 release 构建资产，dist 不提交。当前 v0.15.0 不被悄悄改写，新功能版本按后续发版指令决定。

安装不自动运行 npm install、下载 Chromium、修改权限或配置，也不直接操作宿主插件缓存。首次 setup 根据当前环境完成已有依赖流程。无终端权限的宿主限制由另一份 spec 处理。

## 5. 错误处理与运维

校验包摘要、必需资源、相对路径边界后，在目标同一文件系统创建暂存目录，完整校验再 rename 切换；保留原目录直到成功，失败回滚并清理暂存。按目标加排他锁；中断后下一次操作可识别并恢复事务，不能把半装目录报告为成功。只处理自己的事务文件。

已有无收据同名目录、未知文件、任何已管理文件被修改或缺失、父目录为越界链接、目标本身为链接均停止写入并显示差异；不提供静默 --force。用户先自行备份/迁移后重试。升级和卸载同样检查完整目录，不删除客户新增的风格或文件。卸载不碰用户作品和共享依赖缓存，不删未由本工具创建的父目录。多文件失败不留下“新收据+旧资源”的混合版本。

退出码：0 成功（包括幂等）；2 参数/作用域不支持；3 冲突或用户修改；4 包不完整/摘要错误；5 文件系统/锁/事务失败。JSON 输出同样包含 code、action、agent、target、version、changed 和可操作错误，不混杂日志。

## 6. 验收标准与测试

1. 从干净源码构建，根名与技能声明一致；仅一个 SKILL.md；全部生成指令引用、风格 catalog、模板和动态样式创建路径闭合。删除源码并移动副本后，列风格、环境检查及新建工程仍从副本成功执行（FR-10）。
2. 发布 ZIP 解压后的接口与源码接口执行同一契约；相同输入连续构建摘要一致，资源损坏明确失败，不把源码工作目录当隐式后备。
3. 各具名 profile 的支持作用域在三系统 CI 临时目录下验证目标、预览零写入、首次安装、幂等、status、升级、卸载；不支持作用域拒绝。路径含中文、空格、#、%；不要求实际安装所有客户端（FR-9/11）。
4. 同路径多 owner 安装卸载、同名冲突、用户改动/新增/删除文件、包损坏、链接越界、锁冲突、切换失败和事务中断均有隔离测试；另一个技能、作品及真实配置字节保持不变。
5. Claude/Codex/ChatGPT 既有安装与导演流程测试保留。完整运行 npm test、npm run lint、npm run smoke；portable 副本至少完成一支最小片的实际渲染，宿主发现与媒体打开按另一份 spec 分别取证。
6. README 给下载解压后的最短安装/检查/首次开拍/升级/卸载示例，按平台显示真实路径。发布资产提供校验和与对应 sourceCommit，不能把本设计稿作为已发布功能。
