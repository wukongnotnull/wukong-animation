# 第五批实施计划

Status: Implemented — main activation pending authorized merge
Spec: [第五批规格](../specs/2026-10-31-1200-ci-protection-upgrade-diagnostics-design.md)

目标：强制执行 main 合并检查，并提供只读升级诊断。
架构：聚合门禁统一依赖可复用 CI；安装诊断核心与 CLI 呈现分离。
技术栈：GitHub Actions/REST、Node 20+ ESM、node:test、现有原生及便携分发。

## 全局约束（原样摘自规格）

1. 只保护 main；不改变插件身份、运行时依赖、工程流程、签批和媒体算法。
2. 不删除或自动修复其他插件、marketplace 配置、旧依赖和用户作品。
3. 诊断默认只读、离线；不能证明的安装来源、远端更新或宿主加载状态显示未知。
4. 保留既有 check 默认输出及退出码契约；新增诊断使用显式选项。
5. CI 失败、取消、跳过或未产生必要结果不能通过合并门禁；不放宽现有断言。
6. 仓库保护变更先保存原配置、验证权限和回退方案；获批实施后再应用，发布另行授权。

## 文件与职责

- .github/workflows/{lint,smoke,jianying,agent-installation}.yml：可复用检查及原触发入口。
- .github/workflows/merge-gate.yml：变更分类、PR 编排和稳定汇总结果。
- tools/ 与 tests/unit/ 下门禁策略模块及对应测试：只验证分类和结果规则，不复制工作流计算结果。
- plugin/engine/core/installation-diagnostics.mjs：只读身份和更新指引。
- plugin/engine/cli/commands/environment.mjs、cli/help.mjs：显式诊断选项与呈现。
- tests/unit/installation-diagnostics.test.mjs、tests/integration/upgrade-diagnostics.test.mjs：隔离故障、保密及无副作用验证。
- docs/CONTRIBUTING.md、docs/agent-installation.md 及验收报告：保护、升级和恢复操作；生成文档通过原生成器更新。

## 任务 0：冻结基线

依赖：两份草案获批。保存 main 原保护、规则集、现有检查名/来源和 Actions 权限；记录 Git 状态。冻结旧 check 输出及退出码；原始配置证据按敏感信息要求本地保存，报告只写必要字段。独立提交文档基线。

## 任务 1：实现稳定门禁

先写变更分类和失败/取消/跳过/缺失结果的反例测试，确认缺少门禁能力导致失败；最小实现后执行对应 node --test。把现有检查改为 workflow_call，并保持 push/手动能力；建立 always 聚合和保守分类。用真实临时 PR 验证文档、代码、失败、恢复成功路径；检查所需任务及剪映实际计数，提交。

## 任务 2：应用 main 保护

依赖任务 1 的稳定检查成功出现在真实 PR，且工作流定义已按后续合并授权进入 main。仅 PR 分支出现检查不足以安全激活：旧 main 派生的新 PR 尚无该定义，会一直等待。激活步骤安排在实现 PR 合并后，实施阶段先交付配置与验证证据。保存旧配置，验证读取/写入权限及检查来源。按规格应用保护并读回。以故意失败的临时 PR 调用合并 API，确认明确拒绝；恢复通过后核对可合并状态，不合入故障测试代码。证据记录后关闭临时 PR；报告写明回退命令及字段。配置不足时保留可审阅成果并说明实际阻碍。

## 任务 3：实现只读升级诊断

先写 native/portable/development/unknown、坏 JSON、版本冲突、缺依赖、无关失效 marketplace 及敏感字段用例，确认目标能力缺失而失败；再实现核心和显式 CLI 入口。隔离子进程验证默认 check 不变、JSON/退出码正确、无网络/更新调用和全部受保护文件不变。执行新增 node --test 及 cli-contracts/cli-lifecycle/module-boundaries，分步提交。

## 任务 4：集成验收

执行 npm test、npm run test:jianying、npm run smoke、npm run lint、npm run build:portable 和 git diff --check；验证打包后的仓库外诊断，以及原生和便携身份。核对 A1–A8、保留原始记录。提交 PR 后在当前提交运行三平台及全部必过检查，复核 main 保护读回；合并和补丁发布按后续授权执行。

每项代码任务采用：失败测试 → 确认有效失败 → 最小实现 → 对应检查通过 → 独立提交。配置操作使用真实 GitHub 验证，不把本地策略单测当成服务器保护已生效。

用户已明确批准第五批规格与实施计划，要求从 CI 合并保护开始实施。

实施与阶段验证见[第五批验收记录](../reports/2026-10-31-ci-protection-upgrade-diagnostics-validation.md)。main 保护和服务器拒绝验证尚未完成；必须先按后续授权合入工作流定义，再激活。最终提交 CI 结果见 PR #122。
