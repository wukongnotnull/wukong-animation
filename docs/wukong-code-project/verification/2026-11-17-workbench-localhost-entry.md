# 工作台 localhost 入口验证

日期：2026-11-17。

## 故障与修复

原有端口 63711 上，连接 127.0.0.1 并发送 `Host: localhost:63711` 的 GET 根路径返回 403，正文为“仅接受本机工作台的同源请求”；标准 IP Host 返回 200。

新增集成测试在修复前失败：期望 307、实际 403。修复仅为 localhost 的 GET/HEAD 文档入口增加固定标准地址跳转，API、写请求和控制路由的来源限制保持原样。

## 自动验证

- `node --test tests/integration/workbench.test.mjs tests/integration/workbench-reuse.test.mjs tests/integration/workbench-multi-project.test.mjs`：32 项全部通过。
- `node --check plugin/engine/cli/workbench-server.mjs`：通过。
- `node tools/lint.mjs`：通过。
- `git diff --check`：通过。
- 独立代码及安全审查：未发现本次差异引入的可复现问题。

覆盖 GET/HEAD、无来源头导航、document 导航、查询参数保留、含外部 URL 的查询不改变目标、空响应体、no-store；非法主机、端口、Origin（含空值/null）、iframe/empty、POST、静态资源、API 和控制入口继续拒绝。原有跨源及端口剥离兼容回归全部通过。

## 浏览器与当前本机服务

通过 preview 工具启动隔离样本端口 63917，从 localhost 入口导航后页面位于标准 IP 地址，显示“已连接 · 素材保留本机”；简报正常读取，隔离样本的批注完成提交，页面历史与 `/api/pending` 都包含该条批注。无控制台错误、无失败网络请求。浏览器工具在导航时使用了标准地址，307 本身以 HTTP 集成测试及实际 63711 原始 Host 请求验证。

原 63711 进程运行于只读插件安装缓存。停止该旧进程后，使用 `.claude/launch.json` 中的仓库源码启动项接管同一端口，不修改缓存或插件版本。前后影片目录与身份逐项比对一致，6 支影片全部保留。实际 `Host: localhost:63711` 返回 307，Location 为 `http://127.0.0.1:63711/`，影片 query 保持不变。

未运行视频渲染及与本次入口修复无关的全量检查。当前运行的是仓库修复版，已安装插件缓存仍为原版；本次不发布或推送。
