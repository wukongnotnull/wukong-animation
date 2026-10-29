# 主流 Agent 安装实施计划

目标：保留原生插件，用完整技能包和共享流程覆盖至少25个有依据工具族。

架构：从 plugin 唯一源码生成单入口 portable 包；声明式 profiles 驱动 Node 安装生命周期，宿主按实际工具选择交互和交付。发布 ZIP 包含离线安装器与清单，安装副本独立定位资源。

技术栈：Node.js 20+ 标准库、node:test、GitHub Actions 三系统安装契约。

批准依据：用户明确批准两份 2026-10-29-2017 spec。关联 #98 / PR #99。

## 全局约束（从 spec 原样摘录）

约束、兼容性与非目标

支持 macOS/Linux/Windows 的 Node 路径语义，所有外部进程参数使用参数数组；中文、空格、#、% 不作为 shell 代码。global 根用 os.homedir()，仅 profile 明确声明时支持对应配置目录环境变量；测试注入临时 home，不碰真实用户目录。项目根必须已存在且为明确绝对目录。Windows 不为安装建 junction。

仅打包运行所需代码、锁文件、技能指令、风格/模板/必要示例和许可证；排除 node_modules、依赖缓存、.git、测试、维护文档、客户作品和渲染成片。自定义资源不允许从包外链接补齐。生成物不人工编辑、不在源码维护第二份引擎；随 release 构建资产，dist 不提交。当前 v0.15.0 不被悄悄改写，新功能版本按后续发版指令决定。

安装不自动运行 npm install、下载 Chromium、修改权限或配置，也不直接操作宿主插件缓存。首次 setup 根据当前环境完成已有依赖流程。无终端权限的宿主限制由另一份 spec 处理。


约束、兼容性与非目标

不自动安装各家客户端、登录、申请额度、修改模型/权限或发布商店。远程/云端在目标工作区单独安装和检查，不继承本地能力。OpenCode v1/v2、Copilot 各客户端和地区 variant 分别记录发现结果，不互相冒用。

规则仅共享一份；禁止复制 27 份导演。现有签批、制作记录、项目结构和原生调用保持兼容。#93 的人工播放未验证继续保留，不因增加 generic 交付而消除。


## 文件与任务

1. `tests/integration/portable-installation.test.mjs`：先添加新命令缺失的失败测试；`distribution/portable/SKILL.md`、`tools/build-portable.mjs` 实现完整技能包和确定性发布 ZIP；`plugin/engine/core/styles.mjs` 根据 portable 标识创建 INSTRUCTIONS.md。先 `node --test tests/integration/portable-installation.test.mjs` 观察缺失功能失败，最小实现后重跑并提交。
2. `distribution/agents.json`：固定工具族、变体和路径证据；`tools/install-agent.mjs` 提供 list/install/status/upgrade/uninstall。先增加隔离 home 下 profile 生命周期、冲突、故障、共享目标和路径测试并运行确认失败，再实现、重跑并提交。
3. `tests/unit/delivery-decisions.test.mjs` 与 portable 指令测试先覆盖 generic 输出和能力降级；随后改 `plugin/engine/core/delivery.mjs`、CLI 帮助及共享导演能力参考；重跑后提交。
4. `docs/agent-installation.md`、README 与 `.github/workflows/agent-installation.yml`：生成平台矩阵与三系统独立契约；`docs/wukong-code-project/reports/2026-10-29-agent-installation-validation.md` 留存真实运行证据。运行 lint、完整 npm test、smoke 和 portable 实际渲染；可用宿主中实际发现入口与制作另行记录，不能用终端冒充。未验证项如实保留，未达到门槛不关闭 issue。

每项均按失败测试 → 确认失败 → 最小实现 → 确认通过 → 提交推进。测试使用临时目录，不触碰用户 Agent 配置；无实际客户端可用时不安装客户端、不制造验证结论。
