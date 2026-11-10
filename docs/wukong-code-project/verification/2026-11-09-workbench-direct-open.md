# 本机地址直接打开工作台验收

日期：2026-11-09；关联 [#127](https://github.com/wukongnotnull/wukong-animation/issues/127)，[规格](../specs/2026-11-09-2014-workbench-direct-open-design.md)。

## 实现

移除工作台 token 的生成、传递、存储和校验，启动链接改为裸地址。服务继续仅监听 127.0.0.1；API 与媒体必须来自浏览器标识的 same-origin，Host 与存在的 Origin 精确匹配当前端口，写入必须额外携带 Origin 并使用 JSON。旧带 fragment 的地址仍可打开并清除 fragment。

不新增登录或握手接口，不改版本号、安装缓存或生产流程。复用历史视频检查加载，没有生成视频。

## 自动检查

- 新增 3 项 HTTP 回归首先在旧实现失败：默认 URL 仍有 fragment、请求仍要求 token、重启仍返回 401。
- `node --test tests/unit/workbench*.test.mjs tests/integration/workbench.test.mjs`：38 通过，0 失败/跳过。
- `node --test tests/integration/desktop-plugin.test.mjs tests/unit/cli-contracts.test.mjs tests/unit/cli-lifecycle.test.mjs tests/unit/cli-unknown-command.test.mjs`：14 通过，0 失败/跳过。
- `npm run lint`：通过，82 个模块无循环。
- `node --check plugin/engine/workbench/app.js`、`git diff --check`：通过。

测试验证无凭据读取与媒体分段请求、真实审阅写入、来源缺失/跨站/同站不同端口/错误 Host/空 Origin 拒绝、旧 Bearer/query token 不能绕过来源检查、跨源预检/表单拒绝、重启同端口可直接读、草稿跨服务恢复、旧档案只读。

测试初次实现阶段发现两处测试传输问题：Node fetch 会重建 Host，改用真实 node:http 验证 Host 拒绝；重启用例禁用连接复用，以免使用刚关闭服务的旧连接。没有为测试放宽服务检查。

本次为无视频定向验证，没有运行包含视频生成的全量媒体集合或远程 CI。

## 实际浏览器

- 内嵌浏览器全新端口/新标签页，直接输入无 fragment 地址显示“已连接”；刷新成功。
- 旧 fragment 地址可用且地址栏清除 fragment。
- 《春江花月夜》原有 1080p 视频加载成功，readyState 4、时长 148.79 秒、无媒体错误；媒体 URL 无 token，并可定位至 8 秒。未把短时加载检查当作全片听审。
- 独立临时项目中从裸地址打开并保存一条测试意见，页面显示 1 条待处理意见；真实浏览器 POST 成功。没有操作用户影片的正式意见或签批。
- 两个原预览服务已换为仓库本地实现并保持原端口：`http://127.0.0.1:63711/`（春江花月夜）、`http://127.0.0.1:63915/`（七十二变）；均显示已连接。七十二变仍仅有历史源文件，本轮未生成视频。
- 外置 Chrome 156 仍有独立的请求头改写问题：最终发送的 Origin 省略端口，CSS/JS 返回 403。此行为与缺少 token 分开；未绕过来源检查、未改浏览器扩展设置，不能宣称外置 Chrome 已恢复。

本机截图保留在 `/Users/wukong/.codex/visualizations/2026/11/09/01a1c033-2c33-7941-8d90-96681ac67ddb/workbench-direct-open/`：`preview.jpg` 为实际成片页面，`write-check.jpg` 为临时项目意见保存结果。

## 收尾

已关闭本轮临时测试页面与测试服务，并清理本轮专用临时项目；两个实际示范片服务继续运行。未修改或清理用户浏览器草稿、既有 outputs/、tmp/ 或历史成片。

分支 `codex/workbench-direct-open` 含本轮独立提交、尚未合并，因此保留。只有当前 worktree；远程仅 main，没有已合并闲置分支/worktree 需要删除。未推送、未开 PR、未发布、不同步 GitHub Projects。
