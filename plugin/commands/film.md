---
description: 用 wukong-animation 拍一支动画短片（从制作简报到终审交付，或恢复在制项目）
argument-hint: "[故事 / 主题，可留空]"
---

用户想拍一支动画短片。故事或主题：$ARGUMENTS

请使用 `director` skill，严格按其中的 14 道工序和 10 个审片节点进行；要用户做选择的地方用选择卡片（`AskUserQuestion`）。
引擎命令为：`node "${CLAUDE_PLUGIN_ROOT}/engine/bin/wka.mjs"`。

先执行：
1. `node "${CLAUDE_PLUGIN_ROOT}/engine/bin/wka.mjs" check`
2. `node "${CLAUDE_PLUGIN_ROOT}/engine/bin/wka.mjs" init-project`
3. `node "${CLAUDE_PLUGIN_ROOT}/engine/bin/wka.mjs" status`

如果有在制的片子，先用选择卡片问用户恢复哪支片还是新建；如果故事为空，先问用户想拍什么。
