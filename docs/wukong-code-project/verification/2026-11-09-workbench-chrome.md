# 外置 Chrome 本地预览兼容验收

日期：2026-11-09；关联 [#127](https://github.com/wukongnotnull/wukong-animation/issues/127)，[修订规格](../specs/2026-11-09-2014-workbench-direct-open-design.md)。承接裸地址实现 `43876f5`，规格修订提交 `6166d54`。

## 根因与修复

在当前外置 Chrome 156 复现白底文字和“正在连接”：浏览器最终发送的 Host 是准确本机地址，Origin 为 `http://127.0.0.1`（缺少端口），Sec-Fetch-Site 仍是 same-origin。CSS/JS 因严格 Origin 比较返回 403，CSS 进一步触发 JSON 响应类型错误。

服务新增唯一兼容形态：准确 Host、浏览器同源元数据、Origin 恰为 `http://127.0.0.1`。静态资源、API、媒体与 JSON 写入沿用同一判断。其他端口/主机/协议/null/尾斜杠、缺失或 none/same-site/cross-site 元数据继续拒绝。没有增加 CORS 放行，没有更改浏览器扩展或安全设置，没有恢复 token。

这依赖浏览器控制 Fetch Metadata 的已有边界；不把本机恶意程序或高权限扩展当作可隔离对象。普通网页不能自行伪造该请求头。实现不尝试访问此前被工具策略禁止的扩展管理页。

## 回归

- 新增 Chrome 复现测试先在旧实现以 `/app.css: 403 != 200` 失败；外站与缺失元数据拒绝测试在旧实现即通过，修复后继续通过。
- `node --test tests/unit/workbench*.test.mjs tests/integration/workbench.test.mjs`：40/40 通过，0 失败/跳过。
- 新用例覆盖 CSS/JS/全部模块、影片读取、媒体 Range、意见提交；错误来源组合与表单写入被拒绝，未产生非预期写入。既有 Host 检查同时覆盖正常与端口删除的 Origin。
- `npm run lint`、`git diff --check` 通过；82 模块无循环。
- 本轮不运行媒体生成集合、不生成视频、不把本地检查当作远程 CI。

## 真实浏览器

- 刷新用户当前 Chrome 标签页后，深色界面和影片列表恢复，状态显示“已连接”。请求的 Origin 仍缺少端口、同源标记保留；CSS、JS、三个模块及影片/报告/状态 API 均返回 200。
- 《春江花月夜》原有视频实际播放约 13.41 秒后暂停：1920×1080、时长 148.79 秒、readyState 4、无媒体错误。此结果证明加载与短时播放，不是全片听审。
- 外置 Chrome 独立临时项目保存一条意见成功，页面显示 1 条未关闭意见。没有写用户影片的意见或签批。
- Chrome 直接打开《七十二变》裸地址，正确显示该片历史文件与已连接状态。该片尚无成片，本次没有生成视频。
- 内嵌浏览器刷新原地址仍正常连接。
- 浏览器记录另有既有 favicon 400 和扩展自身 LanguageDetector 信息；不影响上述资源/媒体/意见功能，本轮不夹带修复。

截图保留在 `/Users/wukong/.codex/visualizations/2026/11/09/01a1c033-2c33-7941-8d90-96681ac67ddb/workbench-chrome-fix/`：`chrome-preview.jpg`、`chrome-write.jpg`。

## 交付与清理

两个实际服务已重启为仓库修复版，端口保持 63711、63915；外置 Chrome 两个页面保留给用户。临时验收页面、服务及本轮专用临时项目已清理。原有 outputs/、tmp/、历史影片及截图证据保留。

本地功能分支 `codex/workbench-direct-open` 含未合并独立提交，保留；只有当前 worktree，无已确认闲置且合并的分支/worktree 需清理。版本不变，未修改安装缓存，未推送、开 PR 或发布，不同步 Projects。
