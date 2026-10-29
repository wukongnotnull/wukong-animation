# 主流 Agent 安装验证记录

日期：2026-10-29；跟踪 #98 / PR #99；源码运行时代码基线 `9d4fba2`（后续安装测试覆盖全部 variants）。

## 计数与边界

首批 27 个目标工具族：25 个 portable 工具族提供启用安装契约，ChatGPT 本地执行保留原生渠道，Cline 为候选且禁止写入。合计 26 个有依据的安装适配工具族。该数仅表示路径、资源和安装生命周期契约，不是 26 个客户端全功能实测。

当前真实客户端发现通过数：1（Codex CLI 0.147.0 的 app-server skills/list）；从该安装入口实际执行制作引擎并输出视频通过数：1（本 Codex 会话）。不是另起一个模型会话自动完成全套导演签批流程。媒体实际打开仍未验证，#93 对应待办保留。

macOS 27.0 / arm64 本地完成安装契约，Linux/macOS/Windows 的 hosted CI 结果由 PR 检查与下文追加记录为准。客户端数字最低版本未获得可靠依据，不虚构下限。

## 逐工具证据

目录与依据日期/revision 见 distribution/agents.json 和安装指南，目录依据固定到 2026-10-29 的 skills 安装器提交 92a9a34；Cascade 另有当前官方文档。每个 portable 工具的所有已声明 variants、P/G 两作用域均在隔离目录运行生命周期测试，未安装任何第三方客户端。

| 工具族 | 适用系统/客户端版本 | 安装契约（本地 macOS） | 实际发现 | 环境检查 | 最小渲染 | 媒体打开 |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Codex | macOS 27.0 / Codex CLI 0.147.0 | passed：全部 variants / P、G | passed | passed | passed | untested |
| ChatGPT 桌面本地执行 | macOS 27.0 / 客户端 untested | passed：既有原生回归 | untested | untested | untested | untested |
| Cursor | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| GitHub Copilot | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Gemini CLI | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| OpenCode | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Devin Desktop / Windsurf | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Antigravity | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Cline | macOS 27.0 / 客户端 untested | limited：候选禁止写入 | untested | untested | untested | untested |
| Roo Code | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Kiro | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Factory Droid | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Amp | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Continue | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Goose | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Qwen Code | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Kimi Code CLI | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Trae | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| CodeBuddy | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Qoder | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Augment | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| OpenClaw | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| OpenHands | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Pi | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Warp | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |
| Zed | macOS 27.0 / 客户端 untested | passed：全部 variants / P、G | untested | untested | untested | untested |

## 实际操作与验证材料

1. 先添加 portable CLI 不存在的失败测试，再实现；新增幂等用例暴露 changed 不正确，修复后通过。故障恢复用例暴露目标已移入 backup 时卸载过早返回，修复后通过。generic delivery 用例先出现 host 不支持失败，再实现并通过。
2. 构建包只含一个 SKILL.md，208 个运行文件（不含 bundle.json），可移动目录读取风格；portable 自建风格生成 INSTRUCTIONS.md。连续构建 ZIP 字节一致；Python zipfile 独立验证 ZIP CRC 与解压后的安装器入口。
3. 隔离目录测试覆盖各 portable family/variant 的项目及用户作用域、预览零写入、安装、重复零变更、status、修改保护、卸载；共享目录多 owner；损坏升级包、正式切换失败回滚、活跃锁、中断备份恢复、外部同名目录保护。未写真实 Agent 技能或通用配置。
4. 在临时项目以第一方安装器安装 codex profile，调用实际 `codex app-server --stdio` 的 initialize / skills/list（无模型生成与子代理），forceReload 后只发现一条本包入口，enabled=true、scope=repo。然后本会话读取实际返回的 SKILL.md/HOSTS.md，从该副本执行 check、list styles、init、final。
5. 最小 fixture：320×180、10fps、1秒、运动圆点与合成琴音；ffprobe：视频10帧、10/1fps、有效音频流、时长1.000000秒。fixture 是安装制作验证，未冒充客户签批片，也未写入客户工程。

完整机器证据与验证视频保存在本次任务的 agent-installation-validation 目录（不随插件分发）：

- discovery.json：实际宿主返回的当前包入口；
- commands.json：环境检查、新建与渲染命令及退出码；
- ffprobe.json：音视频流及帧数、时长；
- portable-validation.mp4：验证片。

本地产物根：`/Users/wukong/.codex/visualizations/2026/10/29/01a18638-6b66-7560-82a9-6be129eb754d/agent-installation-validation`。

## 完整回归与 CI

当前仍在运行完整 npm test；最终测试数量、smoke 和三系统 CI 结果在完成后追加。未完成的项目不记为 passed。

## 尚未验证

除上述 Codex 扫描与本会话制作外，其余宿主的实际发现、运行、媒体预览/打开均 untested；远程/云端也未实测。宿主问答卡片/文字降级为共享指令契约，未在每家模型会话分别验证。Cline 需要具体加载路径佐证再启用。正式发布尚未执行，README 明确当前使用源码构建或 PR CI 产物。
