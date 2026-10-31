# 贡献指南

## 常用命令

在仓库根目录运行。根目录锁定开发检查使用的 Acorn；制作依赖使用 `plugin/engine/` 中独立的清单与锁文件，两者不混用：

| 命令 | 做什么 |
| --- | --- |
| `npm ci` | 按根锁文件安装开发检查依赖，不安装制作依赖 |
| `npm run setup` | 按锁文件安装引擎依赖并登记完成凭据（`plugin/engine/node_modules`） |
| `npm test` | 单元测试 + 集成测试 |
| `npm run test:jianying` | 剪映必跑集合；依赖缺失、失败、取消、跳过、待办或任一文件零用例都失败 |
| `npm run smoke` | 冒烟测试；`npm run smoke -- <风格id>` 只跑一个风格，`-- --update` 更新基准图 |
| `npm run lint` | 清单/文档校验 + 模块架构检查 |
| `npm run check:architecture` | 解析引擎模块，检查循环、依赖方向与动态加载入口 |
| `npm run catalog` | 重新生成 `plugin/catalog.json` |

开发先运行根 `npm ci`，需要制作/媒体测试时再运行 `npm run setup`；仅在引擎目录执行 npm ci 不会登记制作依赖凭据。用户的 `wka setup` 使用随插件分发的引擎清单与锁文件，但安装在用户目录，按锁摘要、平台、架构和 Node 主版本隔离。根开发依赖不随插件分发。旧版依赖目录保留，第一次切换到新身份需要 setup；`wka check` 会显示实际来源，不能用父目录或全局同名包补齐缺失依赖。

## 命令与模块边界

`bin/wka.mjs` 只处理进程参数和退出码。`cli/run.mjs` 统一预检、取锁、登记命令和清理；`cli/commands.mjs` 是 22 个命令及其保护策略的唯一目录，六组处理器按职责放在 `cli/commands/`。新增或调整命令时先核对独立的兼容契约，不能在处理器中直接退出进程或重复取得外层工程锁。受控失败释放自己持有的锁，保留恢复记录；强杀仍使用陈旧锁恢复。

`core` 不依赖 `bin/cli`；film-context、delivery-inputs、qc-config、command-args、qc-source 不得经传递依赖回到渲染/质检/交付编排。旧公开入口保留兼容重导出。提取实现时同步检查 operations、主版复核和最终交付/QC 的来源身份，不能只移动代码却漏掉指纹；旧证据按正常规则重新核实，历史签批保留。

架构工具使用 AST 解析 Git 跟踪的引擎 `.mjs`，检查静态导入、重导出和字符串字面量动态导入。新增文件先纳入 Git；引用未扫描的本地模块、空扫描、解析错误、缺失文件、循环与反向引用都失败。非字面量动态导入只登记 registry.loadModule 的插槽入口和 soundtrack.mixSoundtrackFresh 的用户脚本入口，位置、函数与表达式必须匹配；新增入口须更新设计与规则。此检查不执行模块，也不证明任意用户脚本无环。明显的 CLI 进程退出/导入时启动另有语法检查，导入副作用和连续调用契约用真实进程测试覆盖。

## 性能基准

开发测量工具不随插件分发。从明确提交的干净 Git 副本测量，先保存基线，再修改生产代码。两份副本必须使用相同 package/lock；工具把依赖、影片、制作缓存和剪映路径隔离在全新的输出目录中，不清理系统缓存。正式计时不启用读取探针；每个场景另运行一次探针，仅用于统计逻辑读取与子进程工作量。

```bash
node tools/bench-performance.mjs --engine /absolute/baseline/plugin/engine --suite hash --rounds 5 --out /absolute/new-hash-results
node tools/bench-performance.mjs --engine /absolute/baseline/plugin/engine --candidate /absolute/candidate/plugin/engine --suite workflow --rounds 5 --out /absolute/new-workflow-results
```

`hash` 覆盖 8/64/256 MiB 文件及 107 镜状态观察；`workflow` 覆盖 browser/Remotion 的例片、107 镜长片、256 MiB 有效 PCM 音轨。每组分别测 preview 与 render --proxy 的首次、无改和单镜变化；长片还测 resume、QC 和最终交付查询。准备时间单列。已有缓存的每轮都恢复到同一路径下的固定快照，单镜变化只追加注释。工具核对重渲数量、帧数、尺寸、帧率及首末局部小样的音频区间；不会替测试作品做用户签批。

可用 `--cases browser-example,remotion-long` 分批运行 workflow，允许的名字为 `browser|remotion` 加 `example|long|large-audio`；`--timeout` 为单命令毫秒上限（默认 20 分钟）。每场景至少 5 轮。输出目录已存在即拒绝覆盖；失败/超时保留日志，结果标记为未完成，不能删掉失败后称整组通过。只终止本工具启动的进程树。

`environment.json` 记录提交、工具摘要和环境，`preparations.json` 保存安装与预热时间，`results.json` 保存原始样本和中位数/范围。`*.operation.json` 是排除导入开销的哈希耗时；workflow 的墙钟含整个命令。`*.metrics.json` 的 CPU 与最大 RSS 只属于主 Node 进程，不包含 Chromium/ffmpeg；文件计数是逻辑读取、完整读取次数和最大请求字节，不是物理磁盘吞吐。哈希套件的目标文件完整读取对应完整内容哈希；制作流程的读取还可能来自文本解析等用途。OS 文件缓存未控制，不能称为冷磁盘测量。正式比较应串行交替两个版本，期间不要另跑渲染或测试。 探针只覆盖主 Node 显式同步文件 API，排除模块加载器、原生库和子进程 I/O；`fsCalls` 是这些 API 的调用次数，不是完整系统调用计数。子进程耗时可能重叠，不能直接相加。工具会验证依赖清单、保存自身源码，并在运行时身份中记录 Chromium 与系统字体内容摘要；隔离安装禁用浏览器垃圾回收。

## 流程版本保护

当前支持 flow 5，缺失 flow 字段按历史 flow 1 迁移；已知 1–4 的迁移规则保持不变。遇到较新版本会报 `WKA_FLOW_TOO_NEW`，非法 flow 或损坏 JSON 会报 `WKA_FLOW_INVALID`，不会写锁、缓存、签批、报告或 Git。`--force` 不绕过此检查；较新工程需升级插件后继续，损坏状态需核实备份，不能靠删掉版本字段恢复。

`wka status` 在混合项目中继续显示兼容影片，逐片报告不兼容影片，并以 1 退出。`wka resume <片目录> --json` 的诊断包含 `code`、`flow`、`supportedFlow`、`stateFile`、`readonly` 和 `instruction`，不为较新工程推断下一工序。

## 剪映必跑检查

普通 `npm test` 保留本机缺少可选依赖时的明确跳过；独立 `jianying` workflow 在每次 push、PR 和手动触发时运行严格入口，不按文件路径过滤。使用 Node 20、Python 3.11、`tests/requirements-jianying.txt` 中固定的 pyJianYingDraft 0.3.1，以及 ffmpeg/ffprobe、中文字体、MediaInfo 和 Chromium。缓存只加速下载，每次仍执行安装与可运行性预检。

本地在隔离 Python 环境安装 `python3 -m pip install -r tests/requirements-jianying.txt`，执行 `npm run setup` 和 `node plugin/engine/node_modules/playwright/cli.js install chromium`，确认系统视频工具和字体齐备后运行 `npm run test:jianying`。本地 Python 支持 3.8 及以上的 3.x；预检会验证实际版本、导入和浏览器启动。测试集合固定为剪映导出、最终交付集成及字体映射三文件，使用结构化逐例结果计数，不能通过改环境变量清空集合。

Linux CI 验证真实草稿结构、媒体与签批绑定，不代表剪映桌面已打开验收；桌面打开、字幕观感仍需单独核实。workflow 必跑与 GitHub 服务端必需检查是两层设置，本次没有修改分支保护。

## 新增一种风格

```bash
node tools/new-style.mjs watercolor --name 水彩晕染 --category shouhui
```

`tools/plan72.json` 里已有的 id 会自动沿用规划的序号，模板在 `plugin/engine/templates/style-skill/`（脚本内部调用 `wka new style --dest plugin/skills`；只给自己用的风格直接 `wka new style <id> --name 名称`，建在 `~/.wukong-animation/styles/`）。然后：

1. **STYLE.md**：九段结构（本质 / 色彩 / 构图 / 技法 / 运动 / 声音 / 禁忌 / 示范片 / 质检），lint 会检查。
2. **style.json**：管线、工具包（带版本范围）、字体、`qc` 阈值。
3. **scripts/**：把最难写的技法做成积木，挂到 `wk.<名>`。镜头只做编排。
4. **TECH.md**：选型理由 + 积木 API。
5. **examples/<片名>/**：10–20 秒示范片，必须 `wka qc` 全部通过。示范长篇旁白等特定做法的示范片可以更长（如 ink-wash 的《春江花月夜》148.8 秒），在风格 STYLE.md「9. 示范片」里写明它示范什么；冒烟测试只渲染首、中、末三张静帧，片长不影响 CI 用时。
6. `node tools/render-stills.mjs <id>`（画廊图 `docs/gallery/<id>.jpg`，取最短示范片最后一镜 80% 处，只提交 jpg）→ `npm run catalog`（把画廊图写进 README）→ `npm run smoke -- <id>`（首次会写入本机平台的基准图 `tests/smoke/baseline/<darwin|linux>/`）。CI 跑在 Linux 上，缺 linux 基准图会直接失败：在 GitHub Actions 里手动运行 smoke workflow 并勾选 `update`，下载 `smoke-baseline-linux` artifact，放进 `tests/smoke/baseline/linux/` 一起提交。
7. `npm run lint` 通过后提 PR。

SKILL.md 的 description 控制在 200 字以内，并写清与相近风格的区别（例如"比工笔更写意"）——72 条描述会常驻上下文。

## 本地试装插件

不要用工作区路径本地安装插件（例如在 Claude Code 里把 marketplace 指向这个仓库目录）。本地安装会复制整个 `plugin/` 目录，包括被 `.gitignore` 挡住、只存在你机器上的示范片成片、配音、静帧和审片文件（一部示范片就可能有几百 MB）。要试装，先推到 GitHub 再从 GitHub 安装；或者 `git clone` 一份干净的副本，用那份副本的路径安装。

## 新增工具包 / 管线 / 导出器

```bash
node tools/new-kit.mjs particles --desc "GPU 粒子"
node tools/new-pipeline.mjs blender --desc "Blender 无头渲染"
node tools/new-kit.mjs webm-alpha --exporter --ext webm
```

新目录会被引擎自动注册，**不需要改 core/**。规矩：

1. 至少有两个风格要用，才新建工具包；只有一个风格用的代码留在该风格的 `scripts/`。
2. 工具包每个导出函数都写 JSDoc，`node tools/build-docs.mjs` 生成 README（CI 会检查是否最新）。
3. 只用传入的 seed 产生随机性；函数必须是纯函数或只读缓存。
4. 重依赖（Blender、Manim）设为可选：`check()` 缺依赖时给出安装提示，不影响其他管线。
5. 改了引擎或工具包要跑 `npm test` 和 `npm run smoke`，确认没有把已有风格改坏；确实需要改变画面时用 `--update` 更新基准并在 PR 里说明。

## 版权

- 只使用 SIL OFL 等可商用开源字体（登记在 `engine/core/fonts.mjs` 的 `KNOWN_FONTS`，值写它在 google/fonts 仓库里的路径，如 `ofl/mashanzheng/MaShanZheng-Regular.ttf`；下载会自动走 GitHub → jsDelivr）。
- 声音用 `engine/audio/synth.mjs` 合成，或使用明确可商用的素材并在示范片目录写明来源。
- 风格用通用技法描述，不模仿特定画家、工作室或作品的具体画面。

## 桌面插件本地试装

安装器会复制整个 `plugin/`，所以从干净副本试装。若改动已提交，可在仓库终端运行以下命令（需要本机 `git`、`tar` 与支持 `codex plugin` 的 Codex）：

```bash
trial_dir="$(mktemp -d)/wukong-animation"
mkdir -p "$trial_dir"
git archive HEAD | tar -x -C "$trial_dir"
codex plugin marketplace add "$trial_dir"
codex plugin add wukong-animation@wukong-animation
```

尚未提交的改动不会进入 `git archive HEAD`。开发中需要包含未提交文件时，可用以下命令只复制 Git 跟踪文件和未忽略的新文件，排除本机依赖、缓存和成片；`trial_dir` 是任务专用临时变量：

```bash
trial_dir="$(mktemp -d)/wukong-animation"
python3 - "$trial_dir" <<'PY'
import pathlib, shutil, subprocess, sys
root = pathlib.Path.cwd()
dest = pathlib.Path(sys.argv[1])
paths = subprocess.check_output(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"])
for item in paths.split(b"\0"):
    if not item:
        continue
    rel = pathlib.Path(item.decode())
    source = root / rel
    if not source.is_file():
        continue
    target = dest / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
PY
codex plugin marketplace add "$trial_dir"
codex plugin add wukong-animation@wukong-animation
```

在桌面插件目录确认安装并启用，然后打开新聊天，选择一个**不在试装副本或插件缓存中**的作品目录。验证：

1. 「用 wukong-animation 检查环境」只检查；「检查并配置环境」才下载 npm 依赖与 Chromium。检查失败应明确列出缺项。
2. 「用 wukong-animation 推荐动画风格」能列出水墨、Keynote 与规划项，不自动开拍或安装依赖。
3. 「用 wukong-animation 拍一支水墨短片」检查环境、识别在制项目，随后按导演流程等待各节点确认。
4. 无选择卡片工具时退回文字；异步卡片的默认值或等待超时不能当签批。文件链接能在当前宿主打开。

维护时同步 `plugin/plugin.json`、`plugin/.codex-plugin/plugin.json`、`plugin/.claude-plugin/plugin.json` 与 Claude marketplace 的版本；同步两个 OpenAI 清单的展示字段及 onboarding 路径。运行 `node --test tests/integration/desktop-plugin.test.mjs` 检查安装契约与复制后的路径独立性，再运行 `npm test` 和 `npm run lint`。真实桌面 UI 的技能发现、设置入口与音视频预览需要按上面步骤单独验收。

官方格式参考：[插件打包与本地 marketplace](https://developers.openai.com/plugins/build/plugins)。


## main 合并保护（第五批）

PR 由 merge-gate 调用 lint、三平台安装、严格剪映与媒体回归。仅 README.md、LICENSE/其 md/txt 版本、docs 下 md/txt 文档允许跳过媒体；未知路径、混合变更与重命名代码均执行完整检查。缺少、失败、取消或意外跳过必要任务都会使汇总失败。

启用保护前，必须先将 merge-gate.yml 和可复用工作流合并到 main，验证新建 PR 能得到同名 GitHub Actions 检查（App 15368）。否则旧 main 派生的 PR 会缺少必过结果。目标配置位于 tools/main-protection.json；先保存原保护和规则集并再次核对没有并发变更，再通过 GitHub branch protection API 应用。要求 PR、基线最新与 merge-gate 成功，管理员受约束，禁止强推和删除；审批人数为零。

激活后读回全部字段，用故意失败的临时 PR 验证服务器拒绝合并，再恢复通过验证可合并状态，取证后关闭临时 PR。不要合入故障夹具。原配置无保护时，回退为删除本次 branch protection；若激活前已有其他保护，必须按保存的原字段恢复，不能直接删除。当前保护是否已激活以验收报告和 GitHub 实际读回为准。
