# Desktop Plugin Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use wukong-code:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在 Codex 与 ChatGPT 桌面本地执行环境中安装并使用现有动画插件，保留 Claude Code 支持。

**Architecture:** 共用 plugin/skills、catalog 与本地 Node 引擎；新增 Agent Plugins 清单与仓库 marketplace。Claude commands 保留为入口，三个桌面技能通过自身目录定位插件，制作流程兼容宿主提问和文件链接。

**Tech Stack:** Agent Plugins 1.0 JSON、Markdown skills、Node.js >=20、node:test。

## Global Constraints

- 不增加云端渲染、MCP 服务或运行时依赖。
- plugin/ 是唯一插件分发根目录；用户工程保存在所选工作目录，缓存仍在 ~/.wukong-animation/。
- 保留已有 Claude marketplace、commands、15 道工序和 12 个审片节点，签批必须等待用户明确回复。
- 通过干净的插件副本验证，避免复制本机被忽略的视频、依赖和缓存。
- 修改留在 codex/desktop-plugin-support 分支；不自动发布或安装到用户个人插件配置。

### Task 1: 可安装插件与桌面入口

**Files:**
- Create: `.agents/plugins/marketplace.json`, `plugin/plugin.json`, `plugin/.codex-plugin/plugin.json`
- Create: `plugin/skills/{film,setup,styles}/SKILL.md`
- Modify: `plugin/skills/director/SKILL.md`
- Test: `tests/integration/desktop-plugin.test.mjs`

**Interfaces:** marketplace source.path 指向仓库根下的 ./plugin；onboardingSkill 指向 ./skills/setup/SKILL.md；入口技能从自身位置上移两级得到插件根。

- [x] 用 node:test 读取 marketplace 并检查其插件清单，验证 skills、版本与 onboarding 的路径可解析；缺少入口时给出断言失败。
- [x] 运行 `node --test tests/integration/desktop-plugin.test.mjs`，确认因尚未提供桌面插件入口而失败。
- [x] 添加通用清单与 Codex 兼容清单，版本与 Claude 清单保持一致；配置显示名、Creativity 分类和 setup onboarding。
- [x] 逐个添加并验证 film/setup/styles：通过真实安装路径找到 engine/bin/wka.mjs；film 读取同包 director，setup 执行 setup/check，styles 读取 catalog。
- [x] director 根据当前宿主选择提问工具及交付链接，保留文字确认后备与所有签批约束。
- [x] 在临时含空格与中文的安装路径中复制干净插件，清除 Claude 路径变量，用独立工作目录运行 `list styles`、`status`、`brief`、`init`，确认资源发现及工程写入位置。

### Task 2: 安装文档与回归验证

**Files:**
- Modify: `README.md`, `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md`

**Interfaces:** 文档使用已在本机 CLI help 核对的 marketplace/add 语法；自然语言入口适用于两个桌面宿主。

- [x] 写明桌面环境要求、添加来源与安装启用方式，以及本次未推送时应从干净本地副本试装。
- [x] README 区分 Claude 命令和桌面自然语言入口，说明必须有本地终端与文件权限。
- [x] 执行 `npm test`、`npm run lint` 和临时 CODEX_HOME 下的 CLI marketplace 注册、发现、安装验证；清理临时配置。
- [x] 审查改动及新增 skills 的路径、交互与失败分支；报告实际验证范围，桌面 UI 尚未验证则明确说明。

## Review and verification notes

- 只读审查先验证了旧包缺少 film/setup/styles 技能与 onboarding、命令依赖 Claude 路径变量、导演链接与提问方式的宿主假设；改后对同样的应用/检索场景复核通过，无阻塞问题。
- 新增安装契约测试先因缺少 marketplace 与 film 入口断言失败，再实现清单与技能后通过。
- 本机 Codex CLI 在临时独立配置中完成 marketplace add、list、plugin add、list，发现 0.14.0，安装后 enabled=true，缓存中三个入口技能与引擎存在；临时配置已清理。
- `node --test tests/integration/desktop-plugin.test.mjs tests/unit/director-flow.test.mjs`：7 项通过；`npm run lint` 与 `git diff --check` 通过。
- 实际桌面 UI 的技能发现、onboarding 按钮、签批卡片与媒体预览尚未验证；完整视频制作未在新宿主会话中试拍。

- 最终 `npm test`：331 项通过，0 失败、0 跳过，退出码 0（本机 Node.js v25.8.1）；未新增运行时依赖或修改动画引擎。
