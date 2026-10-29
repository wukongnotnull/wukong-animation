# Agent 宿主适配、能力降级与兼容证据

状态：待审；日期：2026-10-29；对应已批准 PRD FR-9/12/13/14；关联 [#98](https://github.com/wukongnotnull/wukong-animation/issues/98)。依赖[可移植分发 spec](2026-10-29-2017-portable-installation-design.md)，本文尚未批准实施。

## 1. 问题与目标

技能能被复制，不代表宿主会发现、能运行引擎或能打开成片。当前导演主要面向 Claude/Codex，delivery 的 host 也只接受二者。目标是以一套制作规则覆盖至少 25 个有依据的工具族，按实际工具做交互与交付，不编造每个平台的实测结果。

路径依据来自[调查报告](../reports/2026-10-29-agent-installation-coverage.md)、官方文档及固定版本的 [skills 适配目录](https://github.com/vercel-labs/skills/blob/92a9a34ac3bf88e695e468b90c7bf32f163d32c8/docs/agents.md)。适配器目录是路径契约依据，不能替代客户端运行证据。

## 2. 架构与组件边界

`distribution/agents.json` 管理安装目标与资料；共享 `plugin/skills/` 指令和新建宿主能力参考文档管理工具选择；引擎 delivery 仅做文件存在性、路径格式和可交付结果，不自行检测客户端或打开应用。所有入口继续进入同一导演阶段和签批记录。

安装器读取 profiles；构建器生成用户安装表；兼容验证报告记录实测。三者使用同一 familyId，IDE/CLI、地区版只作为 variant，数量按 familyId 去重。profiles 不把所有宿主强制映射到同一个 global 目录。

## 3. 接口、数据与行为

### 首批具名安装契约

以下目录后均追加 `wukong-animation/`；`~` 表示 Node 取得的用户 home，P/G 表示支持项目/用户作用域。表中是待实现的目标契约，不是已完成适配的声明。

| familyId | 工具族 | 项目目录 | 用户目录 | 作用域/依据 |
| --- | --- | --- | --- | --- |
| claude-code | Claude Code | .claude/skills | ~/.claude/skills | P/G；原生插件保留；适配目录 |
| codex | Codex | .agents/skills | ~/.agents/skills | P/G；原生插件保留；适配目录 |
| chatgpt-local | ChatGPT 桌面本地执行 | 原生插件渠道 | 原生插件渠道 | 不走目录复制；既有 marketplace 契约 |
| cursor | Cursor | .agents/skills | ~/.cursor/skills | P/G；官方文档/适配目录 |
| github-copilot | Copilot | .agents/skills | ~/.copilot/skills | P/G；官方文档/适配目录；客户端分别验证 |
| gemini-cli | Gemini CLI | .agents/skills | ~/.gemini/skills | P/G；官方文档/适配目录 |
| opencode | OpenCode | .agents/skills | ~/.config/opencode/skills | P/G；官方文档/适配目录 |
| cascade | Windsurf / Devin Desktop | .devin/skills | ~/.config/devin/skills | P/G；当前官方文档；legacy 见下文 |
| antigravity | Antigravity | .agents/skills | ~/.gemini/antigravity/skills | P/G；适配目录；CLI variant 用户目录独立 |
| cline | Cline | .agents/skills | ~/.agents/skills | P/G 候选；待加载代码证实后启用 |
| roo | Roo Code | .roo/skills | ~/.roo/skills | P/G；官方文档/适配目录 |
| kiro | Kiro | .kiro/skills | ~/.kiro/skills | P/G；官方文档；CLI 默认 Agent |
| droid | Factory Droid | .agents/skills | ~/.factory/skills | P/G；适配目录 |
| amp | Amp | .agents/skills | ~/.config/agents/skills | P/G；适配目录 |
| continue | Continue | .continue/skills | ~/.continue/skills | P/G；适配目录 |
| goose | Goose | .goose/skills | ~/.config/goose/skills | P/G；适配目录 |
| qwen-code | Qwen Code | .qwen/skills | ~/.qwen/skills | P/G；官方文档/适配目录 |
| kimi-code | Kimi Code CLI | .agents/skills | ~/.agents/skills | P/G；官方文档/适配目录 |
| trae | Trae | .trae/skills | ~/.trae/skills | P/G；适配目录 |
| codebuddy | CodeBuddy | .codebuddy/skills | ~/.codebuddy/skills | P/G；适配目录 |
| qoder | Qoder | .qoder/skills | ~/.qoder/skills | P/G；适配目录 |
| augment | Augment | .augment/skills | ~/.augment/skills | P/G；适配目录 |
| openclaw | OpenClaw | skills | ~/.openclaw/skills | P/G；适配目录 |
| openhands | OpenHands | .openhands/skills | ~/.openhands/skills | P/G；适配目录 |
| pi | Pi | .agents/skills | ~/.agents/skills | P/G；适配目录 |
| warp | Warp | .agents/skills | ~/.agents/skills | P/G；适配目录 |
| zed | Zed | .agents/skills | ~/.agents/skills | P/G；适配目录 |

明确 variant：cascade 的 windsurf 使用旧 `.windsurf/skills` / `~/.codeium/windsurf/skills`，devin 使用表中目录；antigravity-cli 用户目录为 `~/.gemini/antigravity-cli/skills`；trae-cn、qoder-cn 分别使用 `~/.trae-cn/skills`、`~/.qoder-cn/skills`，项目目录不变。必须显式 --variant，不能同时向新旧目录复制导致重复发现。Kiro IDE 按官方导入机制列出包内技能子目录；自定义 CLI Agent 给出 resources 增补说明，安装器不改写其配置。

Cline 目前只有标准技能支持与第三方路径记录，缺少本轮读取到的官方路径佐证，因此 profile 默认为 candidate、拒绝写入并说明原因；后续确认具体版本的加载代码/文档后更新证据并启用。候选不计入 25 门槛。ChatGPT 原生渠道只在既有安装回归和入口证据仍有效时计数；必要时继续补充有证据的其他工具，不能降低总门槛。

profile schemaVersion=1；每项包含 familyId、label、variants、scopes、projectPath、globalPath、channel、evidence（url/revision/checkedAt/支持能力说明）、qualification（candidate/contract-supported）、限制与发现说明。资料型支持不填虚构最低版本：minimumVersion 为 null 并显示“需支持 Agent Skills 的版本，未确认数字下限”；实测版本另存报告，绝不显示所有版本均兼容。历史兼容依据与变动冲突时优先当前官方资料并收窄适用 variant。

### 能力与导演行为

会话能力使用实际可用工具确定：`terminal`、`readWriteFiles`、`questionUI`、`localMediaPreview`、`fileLinks`；未知视为 unavailable，不靠品牌名推断。记录的是当前会话能力，不持久化跨设备的推测。

- 有终端及文件权限：用安装副本先列版本/风格并检查环境，之后依照已有制作流程。安装成功不跳过 setup。
- 问题卡片可用时用卡片；不可用时发同一项文字问题并等回复。默认选项、超时、空回复均非批准；已明确的素材来源、草稿选择、画幅和字幕不重复问。
- 已有原生专用命令可用就保留；portable 入口使用自然语言“使用 wukong-animation 检查环境/列风格/开始制作/继续工程”。不要求所有宿主接受某个斜杠语法，不写不存在的专有工具。
- 终端或文件能力缺少：只能准备简报/剧本等能完成的内容，明确列出执行限制与本地继续所需步骤；不能报告已安装依赖、已渲染或签批通过。
- 媒体预览可用且实际调用成功，才记录预览证据；否则交付经过存在性检查的文件位置/可用链接。云端路径只有在其工作区或下载机制实际可访问时才交付；本地 home 不能冒充远程资源。

引擎 `delivery` 增加 `--host generic`，保留 codex/claude 现有格式和默认行为。generic 输出真实绝对路径、资源类型和 `previewStatus: unverified`，不凭空生成 file:// 或把绝对本地路径当可点击下载链接；共享指令根据宿主实有预览/附件/文件链接工具呈现。不存在的文件始终报错。其他 familyId 不直接塞给 --host，避免将客户端品牌与链接协议绑定。便携模式中的安装根、工作目录和输出路径必须显式区分。

## 4. 约束、兼容性与非目标

不自动安装各家客户端、登录、申请额度、修改模型/权限或发布商店。远程/云端在目标工作区单独安装和检查，不继承本地能力。OpenCode v1/v2、Copilot 各客户端和地区 variant 分别记录发现结果，不互相冒用。

规则仅共享一份；禁止复制 27 份导演。现有签批、制作记录、项目结构和原生调用保持兼容。#93 的人工播放未验证继续保留，不因增加 generic 交付而消除。

## 5. 错误处理与运维

安装完成但找不到入口时，说明实际路径、版本、作用域及该 profile 的刷新/启用说明；只检查已知路径，不自动复制到一堆猜测目录。重复安装版本、局部覆盖优先级和未启用的 skill 都明确呈现。资料变化使路径依据失效时标记 candidate 并从已支持计数移出；数量不足继续修复覆盖，不能靠文案改成通过。

兼容报告每条包含 familyId/variant、客户端精确版本或 untested、OS/执行环境、来源日期和 revision、包版本与 commit、安装契约、实际发现、环境检查、最小渲染、媒体打开的各级状态，以及命令/输出或人工观察依据。状态限定 passed/failed/untested/limited，不将 untested 当失败或成功。未实际读取源码/客户端输出的版本字段为空并解释原因。

## 6. 验收标准与测试

1. 至少 25 个去重 family 有启用的依据、正确目录、支持作用域、自动化安装契约与使用说明；候选/纯通用目录/地区变体不凑数。表中的各项实施后逐个列证据与结果（FR-9/14）。
2. profile schema、唯一 family/variant、路径边界、每个作用域及共享目标去重在 macOS/Linux/Windows CI 运行；原生三入口保留对应测试。测试产出与用户矩阵使用同一资料，防止文档路径漂移。
3. portable 指令闭合、只有一个技能入口；有/无问答卡片、有/无媒体预览、有/无终端/文件权限的固定场景检查签批与真实交付行为。含中文、空格、#、% 的存在文件和缺失文件测试覆盖 generic，codex/claude 回归不变。
4. 至少一个实际可用 Agent 宿主在新安装副本下发现入口、执行环境检查、新建最小短片、输出可探测的有效视频并留证；终端直接渲染只能证明引擎，不能代替宿主发现。无法安全验证的客户端如实 untested，保留现有工具限制。
5. 实际制作使用最短 fixture 和真实渲染/ffprobe，不要求购买配音服务；片长、帧率、画面及声音存在性按 fixture 验证。媒体实际打开独立列结果，文件存在不当成播放成功。
6. 运行现有完整测试、lint、smoke 及新增安装契约；发布前报告两个不同数字：安装适配工具族数、实际宿主最小制作通过数。README 不出现“27 平台全功能实测通过”之类无证据宣传（FR-13）。
