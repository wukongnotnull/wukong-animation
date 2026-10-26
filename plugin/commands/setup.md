---
description: 安装 wukong-animation 渲染依赖（Chromium、npm 包），检查 ffmpeg / git / 字体工具
---

1. 运行 `node "${CLAUDE_PLUGIN_ROOT}/engine/bin/wka.mjs" setup`。
   它会把 npm 依赖和 Chromium 装到 `~/.wukong-animation/deps/<引擎版本>/`（插件升级不会丢）。
2. 再运行 `node "${CLAUDE_PLUGIN_ROOT}/engine/bin/wka.mjs" check`，把结果整理给用户。
3. 对仍然缺少的项，按用户的操作系统给出一行安装命令：
   - ffmpeg（必需）：macOS `brew install ffmpeg`；Ubuntu `sudo apt install ffmpeg`；Windows `winget install ffmpeg`
   - git（推荐）：用于为每个审片节点做定版存档
   - fonttools（推荐）：`pip install fonttools brotli`，中文字体子集化
   - TTS（可选）：`pip install edge-tts` 或 kokoro，用于 AI 配音（人声）
不要替用户执行需要管理员权限的安装命令，给出命令让用户确认后再运行。
