---
description: 列出 wukong-animation 的动画风格（72 变）与可用状态
argument-hint: "[关键词，可留空]"
---

运行 `node "${CLAUDE_PLUGIN_ROOT}/engine/bin/wka.mjs" list styles`，并读取 `${CLAUDE_PLUGIN_ROOT}/catalog.json`。

用表格向用户展示：序号、名称、分类、适合拍什么、是否可用。
如果用户给了关键词（$ARGUMENTS），按 catalog 里的 keywords 与 best_for 推荐最匹配的 3 种，并各给一句理由。
最后说明：选定风格后可以用 `/wukong-animation:film` 开拍。
