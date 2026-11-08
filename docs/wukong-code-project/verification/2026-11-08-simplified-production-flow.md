# 八道制作流程验证记录

日期：2026-11-08。状态：实现与本轮验收已完成。完整回归首次 534/535 通过，唯一失败已修复并经单独授权的定向复验通过；严格剪映 27/27 通过。修复后未重跑整个媒体集合，结果边界见下文。

关联：PRD FR-35～FR-46；两份 2026-11-08-1217 规格；GitHub #133。发布版本保持原值，未推送或发版。

## 实现范围

- 唯一在用流程为 flow:6、8 道工序、7 个审片节点；方案简报包含美术方向，分镜稿为文字镜头安排。
- 制作小样整合真实录音、按需分镜图、动画、混音与剪辑；内部产物可查看，局部试样不能代替完整小样。制作成片合并渲染与终审，保留主版快照和副版失效保护。
- 旧项目只读留档；读取不迁移、不生成工作台账本、不修改原文件。原快照、批注、阶段结论与进度中的原签批可查看；制作与审阅写入口独立拒绝。
- 删除 AI 人声、字幕制作与专用核验代码、配置及剪映文本轨生成；保留画面标题、题字和历史文件的通用查看。旧命令明确报弃用。
- 整段/多段用户录音只按原文件混入一次；本地识别给出句段时间，有稿匹配原稿，无稿识别。手工补点需明确确认并绑定当前录音/原稿摘要。低可信、重复、遗漏或超时不当作已验证定位。
- 录音/原稿/起点变化令定位过期；修正定位后须应用到制作输入才能签批。cue 写入中断可恢复，手工标记保留。终版只执行一次声音准备，避免重复运行配乐脚本。

## 自动检查

在 Darwin arm64、Node v25.8.1 执行：

- 无视频检查集合：`tests/unit/*.test.mjs` 排除 `approval`、`timing`、`render-performance`、`ffmpeg-pipe`；另含 `architecture-evidence`、`brief`、`flow-guard`、`new-style`、`production-flow-cli`、`upgrade-diagnostics`、`workbench`、`sound-finish`、`sfx`、`desktop-plugin`、`portable-installation`、`setup` 集成文件。它们可能生成临时音频，但未生成视频。
- 完整记录：`/tmp/wka-no-video-final.log`；最终 454 项通过，0 失败、0 跳过，包含“确认定位须应用后签批”的新增覆盖。
- `npm run lint` 包括规范、生成文档一致性和架构检查；82 个引擎模块，无循环依赖。
- 弃用能力的专属测试同步删除；共享媒体测试保留镜头时间轴、声音分轨、缓存/失败恢复、主副版保护、实际导出和草稿编辑保护。生产夹具显式建立新身份，不自动把历史示例当新片。

### 授权的媒体整链检查与定向复验

用户明确回复“开始这批本地测试”，批准 1 批完整回归与严格剪映检查：模型无，仅 Chromium/Remotion/ffmpeg；约 15 个涉及媒体输出的测试文件，以秒级片段为主，含 107 镜长序列；费用和预算均为 0，不调用收费生成接口。按确认约定，失败重跑另行授权。

- 在实现提交 `3575d38` 上执行完整单元与集成集合：`WKA_WORKERS=2 WKA_NO_FONT_DOWNLOAD=1 node --test --test-concurrency=1 tests/unit/*.test.mjs tests/integration/*.test.mjs`。535 项中 534 项通过、1 项失败、0 跳过，约 463 秒；原始日志 `tmp/flow-media-20261108/full.log`。
- 唯一失败：`tests/integration/render.test.mjs` 的 `a second soundtrack run with per-character cues leaves film.json untouched`。再次应用录音定位时，删除并重新插入自动同步点改变了 JSON 键顺序，虽然时间值没变，却重写 `film.json`。新增字节级回归测试先复现失败，日志 `tmp/flow-media-20261108/cue-order-red.log`。
- 原批次内的严格剪映检查在修复前执行：`WKA_WORKERS=2 WKA_NO_FONT_DOWNLOAD=1 npm run test:jianying`。实际草稿导出 11 项、成片交付 2 项、剪映计划 14 项，共 27 项全过、0 跳过；日志 `tmp/flow-media-20261108/jianying-strict.log`。这验证程序生成和检查草稿，未在剪映桌面软件中人工打开验收。
- 最小修复只让“是否需要写入”的同步点内容比较忽略键顺序，无变化时保留工程文件及定位记录的字节内容；中断恢复的前后快照校验、所有权和冲突检查保持原规则。
- 用户另行回复“批准这次定向复验”：原失败项加录音定位 8 项，模型无，视频数量与时长均为 0，仅临时音频，费用和预算均为 0。执行 `node --test --test-name-pattern='a second soundtrack run' tests/integration/render.test.mjs` 与 `node --test tests/unit/voice-alignment.test.mjs`，分别 1/1、8/8 通过，0 失败、0 跳过。日志 `tmp/flow-media-20261108/soundtrack-idempotence-green.log`、`voice-alignment-green.log`。
- 定向复验覆盖重复应用不改文件、实际混音重复运行、输入变化失效、人工标记保留、写入中断恢复、定位应用后签批等边界。未再生成视频，也未把首次完整回归改写为“535 项一次全过”；完整集合和严格剪映的通过证据来自修复前版本，修复由上述 9 项定向检查验证。

## 实际本地识别

使用官方 whisper.cpp 的既有 `samples/jfk.wav`（约 11 秒英文录音），不是新生成的人声。只在当前 Mac 的 CPU 上运行，未上传录音。

- whisper.cpp 源码：`f92e1e4d1056700c39d4e86c1140f0a088fe1ab6`；CMake 关闭 Metal/CUDA，编译 CLI。
- 多语言 base 模型摘要：`60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`。
- 本机 CLI 摘要：`e560c6ab302978b8f3ab9b37b5820e4c97068786163bb79e5d0ee5da874b33b8`。
- 无原稿识别与有原稿匹配均返回 `matched`，2 个句段；方法分别为 `local-recognition` 与 `local-recognition-text-match`。时间来自识别结果，不是按字数均分，不宣称强制对齐或人工逐句听审已完成。
- 依据：[官方 CLI 参数与 JSON 输出](https://github.com/ggml-org/whisper.cpp/blob/f92e1e4d1056700c39d4e86c1140f0a088fe1ab6/examples/cli/cli.cpp)。调用使用本地模型、WAV、JSON、CPU 参数，不使用原稿 prompt，不输出 SRT/VTT。
- 本地证据：`tmp/voice-validation-20261108/recognize.log`、`match.log`、`film/.wka/voice-alignment.json`；工具、模型及源录音保留在同目录，均不加入 Git。

限制：本次没有验证 Windows/Linux 原生安装运行，也没有完成中文、方言、多人或噪声录音的准确率评测。跨平台支持为实现目标，不能由本机结果推断所有平台/录音均通过。

## 实际工作台验收

用本地浏览器打开独立验收目录 `tmp/flow-ui-20261108`，复用既有小样文件，不生成视频。

- 桌面 1440×1000：8 道导航及 7 个节点可见；“方案简报”“分镜稿”“小样视频”“检查结果”归属正确；视频实际播放到约 5 秒；保存一条测试时间批注，显示成功与阻塞状态，缺检查结果不能通过阶段。
- 窄侧栏 420×900：历史档案标识始终可见；视频播放到约 6 秒；文件/预览/意见/检查可切换；标注入口隐藏，检查/修改/通过均不可用；历史进度中的原签批展开可读。
- 旧项目读取和全部写入拒绝另由字节快照测试核对。验收过程中发现旧总览文案易被误认为可继续制作，已改为历史档案及只读说明。
- 截图：`tmp/flow-ui-20261108/new-flow-desktop.jpg`、`archive-narrow.jpg`。视口测试后已恢复默认尺寸。示例内批注仅用于测试，未给任何实际影片签批。

## 交付与清理

本轮实现与上述验收完成，提交留在 `codex/simplified-production-flow`；尚未合并远程 main、推送或发版。发布版本未变。平台与录音准确率限制如上；后续推送所触发的新媒体 CI 仍需独立批次授权。

2026-11-08 核对：本地只有 `main` 与当前进行中的 `codex/simplified-production-flow`；远程只有 `main`（`44892d6`），只有当前根 worktree。没有已合并闲置分支/worktree 可清理。原有未跟踪 `outputs/`、`tmp/` 与本轮模型、录音、界面证据保留；不将这些目录并入功能提交。

## 后续发布检查记录

用户随后明确要求发版，并批准插件 0.21.0、导演文档 1.19.0（引擎仍 0.2.0）与分支推送、PR、main、标签的 4 批 CI。该授权替代实施阶段“不发布、不升版”的边界，发布过程由 [#134](https://github.com/wukongnotnull/wukong-animation/issues/134) 跟踪。

第 1 批针对发布提交 `24d6dae`：三平台安装和 lint 通过；完整回归 536 项，524 通过、0 失败、12 项缺少剪映依赖跳过由严格专项 27/27、零跳过覆盖。随后画面基准入口因 `tests/smoke/run.mjs` 的 shebang 位于导入语句之后而语法失败，尚未运行静帧比对。已将导入放回普通 import 区，使 shebang 恢复首行；仅语法检查完成前后验证，不据此声称基准检查通过。原始 CI 日志保留在 `tmp/release-v021-ci/push-smoke.log`，静态复现记录在 `smoke-syntax-before.log`。失败后的新推送会触发额外一批 CI，须另行确认；剩余三批原授权继续有效。后续实际结果以 #134 与正式 Release 为准。
