# 预览文档搜索验证

## 实现

预览工具栏中央新增当前文件内容搜索，包含普通／当前匹配高亮、当前序号和总数、循环上下跳转、Enter／Shift+Enter、Escape 清空。支持中文、忽略大小写的字面量搜索及跨行内加粗／代码节点。原文和排版模式分别匹配当前显示内容；不搜索其他文件或批注。

切换同文件版本或阅读模式保留关键词；切换文件清空。图片、音视频和加载过程中隐藏控件。窄栏换行，沿用两种主题。CSS Custom Highlight 保持文字节点与批注原始坐标不变；旧浏览器降级为当前匹配元素描边与定位。

## 实际验证

- `node --test tests/unit/workbench*.test.mjs tests/integration/workbench*.test.mjs`：103 项通过。
- `node tools/lint.mjs`、`npm run check:architecture`、`git diff --check`：通过。
- 实际启动隔离工作台后运行 `node tests/browser/workbench-search.mjs http://127.0.0.1:63917 outputs/workbench-search`：通过，Chromium 中搜索模块 V8 字节覆盖率 99%，没有页面异常。
- 浏览器覆盖文字匹配、循环跳转、无结果、清空、原文与排版、版本切换、图片切换、键盘焦点、减少动态效果、旧浏览器降级及批注坐标一致性。
- 两种主题分别检查 320、375、768、1024、1440、1920 像素宽度，搜索工具栏无内部溢出。320、768、1024、1440 留有截图。窄屏验证手动收起两侧栏后完整预览，未改变原有侧栏手动控制规则。
- 搜索高亮文字对比度均高于 6.5:1，输入框有可访问名称、匹配数通过 live status 播报。
- 审查指出的刷新失焦、响应式表头隐藏后计数过期、大代码块二次复杂度均已修复并补充浏览器回归。两万行代码块、两万处匹配实测约 27ms（单次本机样本，不作为所有设备性能保证）。
- 新增搜索模块 gzip 约 2KB，无新增运行依赖或接口。

## 复现与限制

`.claude/launch.json` 中 `workbench-search-preview` 通过 `tests/browser/workbench-search-server.mjs` 创建临时影片并启动本机服务，默认端口 63917。关闭服务清理该临时影片；不会修改真实影片。浏览器测试脚本另行运行并将图片与结果保存在未提交的 `outputs/workbench-search/`。

仅实际验证已安装的 Chromium；本机未安装 Playwright Firefox／WebKit，未进行 Firefox 或 Safari 实测。未运行整站 Lighthouse；本次只验证新增搜索交互性能、资源体积及基础可访问性。
