# 审阅工作台实施计划

目标：实现已批准 PRD FR-15～FR-26 的本地全流程审阅工作台。
架构：既有引擎上增加交付物账本、HTTP 服务和静态界面；签批复用原处理器。所有文件与版本留在本机，返修待办由对话读取。
技术栈：Node.js 原生文件/HTTP 能力，HTML/CSS/JavaScript，node:test，现有 Playwright。
规范：[review-workbench-design](../specs/2026-11-07-2053-review-workbench-design.md)。

全局约束（摘自 spec）：
- 不修改版本号，不同步 Projects，不自动发布或改写已安装插件缓存。
- 不剪辑、不直接编辑文字、不云协作、不上传媒体、不实现专用软件工程编辑器。
- 批注及需要修改不触发制作；每批视频生成必须另获明确授权。
- 不执行影片脚本来预览，不迁移旧 state；兼容检查在任何工作台写入前完成。

## 文件与步骤

1. `tests/unit/workbench.test.mjs`、`tests/integration/workbench.test.mjs`：先加入真实临时工程的失败用例，确认新入口/版本与审阅能力缺失；不靠 mock 证明存档和文件保留。
2. `core/workbench-catalog.mjs`、`core/workbench.mjs`：实现阶段映射、登记、版本与依赖、批注和检查。运行单元测试确认由失败到通过，然后提交。
3. `cli/workbench-server.mjs`、`cli/commands/workbench.mjs` 及命令目录：实现项目边界、凭据、文件服务和审阅接口，接既有签批。跑集成测试及 CLI 契约，提交。
4. `workbench/index.html`、`workbench/app.css`、`workbench/app.js`：实现已确认布局与阅读/播放器、标注、历史、审阅；在真实浏览器逐项验证。
5. `cli/run.mjs`、导演/film 入口、用户说明：接入交付物捕获与待办读取，覆盖前后版本保存；更新生成文档。补制作命令回归，提交。
6. 跑完整测试、lint、smoke；审查 diff 与所有 FR 验收证据，修复失败后再验证。更新 issue 和验证记录，保留与本次无关的未提交工作；清理已合并且闲置分支/worktree，保留在制分支与独立提交。
