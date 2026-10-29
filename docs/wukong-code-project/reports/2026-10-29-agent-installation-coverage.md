# 主流 Agent 安装兼容性调查

日期：2026-10-29（Asia/Shanghai）；源码基线：v0.15.0 / `a91f910`；关联 [#98](https://github.com/wukongnotnull/wukong-animation/issues/98)。

这是需求调查，不是新平台兼容认证。下表是首批 27 个工具族的目标清单；本轮没有安装这些客户端，也没有修改用户的 Agent 配置。

## 结论

保留现有原生插件分发，增加可移植 Agent Skills 路径，能够用共享的制作能力覆盖更多宿主。开放标准允许技能携带脚本、参考和资源，但文件布局与运行环境必须一并验证；不能把技能名称出现在列表里等同于本地动画制作可用。[Agent Skills 规范](https://agentskills.io/specification)

Cursor、Copilot/VS Code、Gemini CLI、OpenCode 均支持通用技能目录或兼容入口，具备复用基础。[Cursor](https://cursor.com/docs/skills)、[VS Code](https://code.visualstudio.com/docs/agent-customization/agent-skills)、[Gemini CLI](https://geminicli.com/docs/cli/skills/)、[OpenCode](https://opencode.ai/docs/skills)

`vercel-labs/skills` 提供多宿主安装适配目录，可作为扩大覆盖的候选渠道；仍需验证其下载/复制后能否保留本插件运行资源。调查固定到该仓库提交 `92a9a34ac3bf88e695e468b90c7bf32f163d32c8`，不把其后变动自动算作本插件已支持。[适配器目录](https://github.com/vercel-labs/skills/blob/92a9a34ac3bf88e695e468b90c7bf32f163d32c8/docs/agents.md)

## 当前源码限制

- film/setup/styles 的 SKILL.md 明确假定自身位于 `<plugin>/skills/<name>/`，上移两级寻找 engine；film 还读取同级 director。孤立复制一份技能会丢掉 engine、风格库、catalog、模板及其他技能。
- director 仍以 Claude、Codex/ChatGPT 为主要宿主描述；delivery 命令的 host 参数目前只接受 codex / claude。其他宿主不能直接套用不存在的卡片工具、固定斜杠命令或未验证的媒体链接规则。
- 原生插件内的 film/setup/styles 名称有插件命名空间；单独安装到通用技能目录时，这些通用名称可能与客户已有技能冲突。
- 当前引擎依赖本地 Node.js 20+、ffmpeg 及渲染依赖；只有网页聊天、无终端/文件权限的宿主，不因装入技能就具备制作能力。
- 需要区分安装成功、宿主实际发现、环境检查通过、最小渲染通过和媒体打开通过；#93 的播放未验证项不能因扩平台而被消除。

## 首批目标矩阵

“目录依据”是标准技能通道的调查线索，不是现在就能执行的本插件安装说明。用户级路径、最低版本和原生插件方式在实施 spec 再逐项固定。IDE/CLI、国际/中国版按工具族合并统计，避免虚增平台数量。

| # | 工具族 | 目录/渠道依据 | 本次调查证据 |
| --- | --- | --- | --- |
| 1 | Claude Code | 保留原生插件；标准技能目录 | 已有源码/安装契约；适配器目录 |
| 2 | Codex | 保留原生插件；通用技能目录 | 已有源码/安装契约；适配器目录 |
| 3 | ChatGPT 桌面本地执行环境 | 保留现有插件清单与技能入口 | 已有源码；不等同于普通网页聊天 |
| 4 | Cursor | `.cursor/skills` / 通用目录 | 官方文档 |
| 5 | GitHub Copilot（VS Code/CLI/App） | `.github/skills` / 通用目录 | 官方文档；不同客户端分别记实测状态 |
| 6 | Gemini CLI | `.gemini/skills` / 通用目录 | 官方文档 |
| 7 | OpenCode | `.opencode/skills` / 通用目录 | 官方文档 |
| 8 | Windsurf/Cascade（当前文档为 Devin Desktop） | `.devin/skills`；兼容旧目录 | 官方文档重定向；旧目录仍被读取 |
| 9 | Antigravity（IDE/CLI） | 通用技能目录 | 适配器目录 |
| 10 | Cline | 标准技能及其宿主适配入口 | 官方技能文档；确切路径需结合版本核实 |
| 11 | Roo Code | `.roo/skills` | 官方文档 |
| 12 | Kiro（IDE/CLI） | `.kiro/skills` | 官方文档；自定义 Agent 需核对资源配置 |
| 13 | Factory Droid | 通用技能目录 | 适配器目录；官网页面本轮抓取失败 |
| 14 | Amp | 通用技能目录 | 适配器目录 |
| 15 | Continue | `.continue/skills` | 适配器目录 |
| 16 | Goose | `.goose/skills` | 适配器目录 |
| 17 | Qwen Code | `.qwen/skills` / 通用目录 | 官方文档 |
| 18 | Kimi Code CLI | 通用技能目录 | 官方文档与适配器目录 |
| 19 | Trae（国际/中国版） | `.trae/skills` | 适配器目录 |
| 20 | CodeBuddy | `.codebuddy/skills` | 适配器目录 |
| 21 | Qoder（国际/中国版） | `.qoder/skills` | 适配器目录 |
| 22 | Augment | `.augment/skills` | 适配器目录 |
| 23 | OpenClaw | `skills` | 适配器目录 |
| 24 | OpenHands | `.openhands/skills` | 适配器目录；执行环境需单独检查 |
| 25 | Pi | 通用技能目录 | 适配器目录 |
| 26 | Warp | 通用技能目录 | 适配器目录 |
| 27 | Zed | 通用技能目录 | 适配器目录 |

表中的“通用技能目录”指项目内 `.agents/skills`，用户级目录由各宿主/安装器规则确定，不能将所有工具都安装到同一个臆测的全局路径。此矩阵不把泛用目录本身计为一个 Agent。

## 需要保留的差异

- Windsurf 文档已重定向为 Devin Desktop，主目录变为 `.devin/skills`，但仍读取旧 `.windsurf/skills`；不能只照搬适配器中的历史品牌和路径。[Cascade Skills](https://docs.devin.ai/desktop/cascade/skills)
- Cline 支持携带脚本/资源的技能、原生按需加载与手动触发；本轮其官方页面未出现适配器所列的通用目录，实施前需要客户端版本或加载代码佐证。[Cline Skills](https://docs.cline.bot/customization/skills)
- Roo Code 支持项目和全局技能及按模式启用；Kiro 支持技能导入，自定义 Agent 的资源声明需核对。[Roo Code](https://roocodeinc.github.io/Roo-Code/features/skills/)、[Kiro](https://kiro.dev/docs/cli/skills/)
- Qwen 同时识别专属与通用目录，重名时有优先级；Kimi 也提供 SKILL.md 扩展。共享安装必须避免重复发现与错选版本。[Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/)、[Kimi Code CLI](https://moonshotai.github.io/kimi-cli/en/customization/skills.html)
- 云端 Agent 还需要可用执行环境、依赖和产物交付通道，不能把本地用户目录自动当成云端可访问资源。项目级安装可作为兼容入口，云端渲染单独记录测试结果。

## 后续设计的选择依据

优先评估“保留原生插件 + 通用技能安装”的组合，复用开放标准及已有多宿主安装工具。仅复制现有技能目录不能解决资源缺失；为每个平台维护一份导演和引擎又容易分叉。打包、运行资源定位、版本固定和更新卸载的确切方案在 PRD 获批后写 spec，本报告不预先批准接口。

目标覆盖至少 25 个工具族；未获得可靠发现机制或不具备必要执行能力的工具，单列待验证/受限，不用虚假的“已适配”凑数。其余标准兼容工具继续扩展，受支持数量随有证据的适配增加。
