# keynote 语义化录音音效库 实施计划

- spec：`docs/wukong-code-project/specs/2026-10-28-1500-keynote-recorded-sfx-design.md`（#43）
- 目标：keynote 片子的 `audio/build.mjs` 能按名字放 18 个 Mixkit 录音音效，电平与处理和 wk-motion-graphics 一致。
- 架构：风格目录放清单 `sfx.json`，`style.json` 用 `sfx` 字段指向它；引擎新模块 `audio/sfx.mjs` 负责下载、处理、叠加与密度检查；`wka sfx` 命令下载，`wka soundtrack` 把 `sfx` 对象传给配乐脚本。
- 技术栈：Node 20（node:test）、ffmpeg、curl。
- 全局约束（摘自 spec）：不提交任何 Mixkit 音频文件；测试不依赖网络下载；没写 `sfx` 的风格和旧 `build.mjs` 行为不变。

## 文件

| 文件 | 职责 |
| --- | --- |
| `plugin/skills/keynote/sfx.json`（新） | 18 项清单 |
| `plugin/skills/keynote/style.json`、`plugin/engine/schemas/style.schema.json` | `sfx` 字段 |
| `plugin/engine/core/paths.mjs` | `SFX_CACHE_DIR` |
| `plugin/engine/audio/sfx.mjs`（新） | `loadSfxLibrary` / `listSfx` / `fetchSfx` / `prepareSfx` / `createSfx`（`place`、`names`、`warnings`） |
| `plugin/engine/audio/soundtrack.mjs` | 传 `sfx`，打印密度警告 |
| `plugin/engine/bin/wka.mjs` | `wka sfx <片> [--list]` |
| `tests/unit/keynote-sfx.test.mjs`（新） | 清单、处理、叠加、密度 |
| `tests/integration/sfx.test.mjs`（新） | 预置缓存 → `wka soundtrack`；无清单风格 → `wka sfx` 报错 |
| keynote `SFX.md`（新）、`STYLE.md`、`TECH.md`、`SKILL.md`，`director/SKILL.md`，《七十二变》`audio/build.mjs` | 文档与示范片 |

## 任务

1. 清单：写清单测试（18 项、与源一致的编号 / maxSeconds / level）→ 失败 → 加 `sfx.json`、schema、`style.json` → 通过。
2. 处理：写处理测试（合成带 0.3 s 前导静音的 wav）→ 失败 → 实现 `prepareSfx` → 通过。
3. 叠加与密度：写 `place` / 错误 / 密度测试 → 失败 → 实现 `createSfx` → 通过。
4. 接入：写集成测试 → 失败 → 改 `soundtrack.mjs`、`wka.mjs` → 通过。
5. 文档与示范片；`node tools/lint.mjs`、`node tools/build-docs.mjs --check`、`node --test tests/unit/*.test.mjs tests/integration/*.test.mjs`。
6. 手动：`wka sfx --list`（HEAD）；经用户同意再真实下载并审听《七十二变》。

命令：`node --test tests/unit/keynote-sfx.test.mjs`、`node --test tests/integration/sfx.test.mjs`。
