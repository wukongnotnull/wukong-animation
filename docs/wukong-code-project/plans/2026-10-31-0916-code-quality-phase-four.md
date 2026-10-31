# 第四批代码质量与架构优化实施计划

Status: Implemented — local validation passed; PR / remote CI pending
Implementation result: [第四批本地验收报告](../reports/2026-10-31-code-quality-phase-four-validation.md)；任务 0–5 的实施与本地验收已完成，A9 三平台远端部分及 A12 当前提交 CI 待 PR 阶段验证。

Spec: [第四批已批准规格](../specs/2026-10-31-0916-code-quality-phase-four-design.md)
Baseline: `76c0d8a534decec724b72a141cb415ce5b6c506a` / v0.19.4

目标：消除命令受控失败后的锁残留与核心静态循环依赖，并用自动检查保护命令和取证边界。

架构：入口只处理进程边界，统一执行器根据单一命令目录执行预检、取锁和清理，六组处理器搬移已有编排。核心提取工程上下文、交付输入、QC 配置及来源签名，原模块保留兼容导出；仓库独立解析模块图，阻止环与反向依赖。

技术栈：Node.js 20+ ESM、node:test、现有 browser/Remotion/ffmpeg、Git、现有基准工具；新增仅开发使用的 Acorn 8.19.0 与根锁文件。顺序实施，不新增代理并行任务。

两份文件已于 2026-10-31 获用户明确批准，审阅未发现实施阻碍；从任务 0 和命令失败清理开始顺序实施，进度沿用 [#113](https://github.com/wukongnotnull/wukong-animation/issues/113)。本次授权包括实施与本地验收，PR、合并、发布和安装升级按后续授权执行。

## 全局约束（原样摘自规格）

1. 保持 Node.js 20+、browser/Remotion、原生与便携分发；不新增用户运行时依赖，不改变引擎锁文件。
2. 保持 22 个命令、原参数语义、退出码、输出结构和旧模块公开导出；受控错误释放当前锁是本批明确的行为修正。
3. 流程版本保护先于锁、active-command、账本、报告及 Git 写入；--force 不绕过保护，失败不覆盖用户素材、作品、签批和暂存内容。
4. 保留原命令的锁范围、取证顺序和独立复读；不跨 await 或跨调用复用来源观察，不削弱最终交付双遍扫描。
5. 所有移出代码都必须纳入相应实现指纹；允许旧证据按现有规则变为待核实，不伪造通过、不改写历史批准。
6. 只做必要提取及涉及代码的清晰排版，不全仓格式化、不迁移 TypeScript、不引入通用框架，不重写音频/渲染/最终交付整个子系统。
7. 保留完整回归、严格剪映、9 张视觉样张与三平台检查；不跳过、删除或放宽既有断言，不更新视觉基准。
8. 规格和计划已于 2026-10-31 获用户批准，按计划实施；PR、合并、发布和本机安装升级另按后续授权执行。

## 文件与职责

| 新建或修改 | 职责 |
| --- | --- |
| 修改 `plugin/engine/bin/wka.mjs`；新建 `plugin/engine/cli/run.mjs`、`commands.mjs`、`context.mjs`、`help.mjs` | 薄入口、执行生命周期、唯一命令策略、调用级参数/错误辅助和原帮助文本 |
| 新建 `plugin/engine/cli/commands/{environment,project,review,media,audio,subtitles-final}.mjs`、`cli/review-artifacts.mjs` | 按职责搬移现有命令、共享审阅证据登记，不新增业务规则 |
| 新建 `plugin/engine/core/film-context.mjs`；修改 `core/job.mjs`、`qc.mjs`、`delivery.mjs`、`final-delivery.mjs` | loadFilm 下沉并改内部依赖方向；原 job 导出保留 |
| 新建 `core/delivery-inputs.mjs`、`qc-config.mjs`、`qc-source.mjs` | 交付输入读取、纯 QC 配置、共享 QC 来源签名；不反向依赖编排模块 |
| 新建 `core/command-args.mjs`；修改 `bin/args.mjs`、`core/delivery.mjs` | 参数解析单一实现和旧路径兼容，消除 core → bin |
| 修改 `core/qc.mjs`、`core/final-delivery.mjs` 的身份计算 | 生产者/校验者共用 QC 签名，交付投影覆盖移出代码；保留历史资料 |
| 新建 `tests/unit/cli-lifecycle.test.mjs`、`cli-contracts.test.mjs`、`module-boundaries.test.mjs` | 失败清理、重复调用、固定命令策略、依赖图与规则反例 |
| 修改现有 args/load-film/qc-judge/delivery/final-delivery 单测；新增 `tests/integration/architecture-evidence.test.mjs` | 旧接口和取证兼容；隔离副本中改变新模块后不能复用旧证据 |
| 按需扩充 flow-guard、recovery-delivery、desktop-plugin、portable-installation 测试 | 新入口仍遵守流程保护、恢复和分发契约，不改已有断言强度 |
| 新建 `tools/check-architecture.mjs`、根 `package-lock.json`；修改根 `package.json` | 开发期模块解析与门禁，固定 Acorn；更新“根无依赖”的过时描述，保留制作 setup 命令 |
| 修改 `.github/workflows/lint.yml`、`smoke.yml`、`agent-installation.yml` 与 `docs/CONTRIBUTING.md` | 需要检查器的任务安装根开发锁依赖；三平台执行无媒体依赖的新增测试；说明两套依赖用途 |
| 新建 `docs/wukong-code-project/reports/<验收日期>-code-quality-phase-four-validation.md` 及证据索引 | 实施后填写 A1–A12、真实命令结果、静态图与配对数据；只记录实际完成的验收结果 |

不计划改动运行时锁文件、schema、FLOW/TIMING_VERSION、媒体算法、基准工具或视觉基准。若实际提取必须修改本表外的调用点，先核对是否仍是原规格允许的导入替换；超出边界则先更新规格。

## 任务 0：冻结可比较基线与兼容契约

依赖：用户批准两份文件。交付物：隔离 v0.19.4 基线、命令策略/导出/指纹迁移清单、现状测试结果。

1. 记录批准、当前 Git 状态和 Node/媒体依赖身份。为基线创建独立 worktree，所有夹具放临时目录，使用独立 `WUKONG_ANIMATION_HOME`；保留用户工程和已安装插件。
2. 从规格的固定列表记录 22 命令与帮助别名、输出流/退出码，以及预检/锁/active-command 的真值表。保真夹具取自冻结基线，不能从候选目录自动生成预期值。
3. 记录旧公开导出和移动代码的指纹归属；特别登记 QC 两处签名与 renderer/encoding 的显式文件列表。记录正常实现变化造成的缓存失效，区分升级后第一次与新版本内暖缓存重跑。
4. 执行现状检查：`node --test tests/unit/args.test.mjs tests/unit/cli-unknown-command.test.mjs tests/unit/load-film.test.mjs tests/unit/qc-judge.test.mjs tests/unit/delivery.test.mjs`，并重现隔离 `signoff --step 999` 锁残留。现状通过项仅是兼容基线，不冒充目标红测或修复通过。
5. 提交仅文档/夹具基线，准备下一个任务的失败回归。若基线本身失败，先识别环境或现存问题，不能通过删除测试继续。

## 任务 1：先修命令错误清理，再建立执行器（Q1，A1–A4）

依赖：任务 0。涉及：bin/wka、cli/run/context/commands/help、cli-lifecycle、cli-contracts。

1. 先写真实临时目录回归：`signoff --step 999` 应退出 1、保留原错误文本及 active-command、移除自有锁；另测异步拒绝、成功返回、锁已被其他 owner 持有的情形。运行 `node --test tests/unit/cli-lifecycle.test.mjs`，确认原实现因遗留锁而失败，而非因工具/夹具错误失败。
2. 最小修复：处理器的失败改为抛异常，顶层统一输出并设置 exitCode，确保 await/finally 完整执行。此时先不搬业务，运行同一回归变绿并提交。
3. 新增可导入执行器的能力测试：导入不执行、连续两个 argv 相互独立、不改 process 全局、业务退出码 2 保留。缺少内部接口要由明确断言指出，不能把模块加载拼写错误计为预期红测。
4. 将预检/锁/active-command 纳入一份命令目录，由执行器统一消费；保留现有精确条件。把帮助文本迁入独立模块。原进程入口只委托执行器；暂留处理器的等价集中实现，任务 3 逐组搬移。
5. 运行 `node --test tests/unit/cli-lifecycle.test.mjs tests/unit/cli-contracts.test.mjs tests/unit/args.test.mjs tests/unit/cli-unknown-command.test.mjs tests/integration/flow-guard.test.mjs`。检查 0/1/2、错误只输出一次、未来流程无任何写入、取锁失败不删他人锁，再提交。

## 任务 2：打断循环并保留证据身份（Q2，A5–A8）

依赖：任务 1。涉及：四个共享低层模块、qc-source、job/qc/delivery/final-delivery、原兼容出口与证据回归。

1. 补低层接口/旧新出口一致性测试；新增有针对性的依赖边断言，先证明四模块循环及 core → bin 违约。保真用例覆盖 requireShots:false、重复镜头、主副版脚本与字幕覆盖、QC 默认/画幅阈值、决定缺失与冲突、路径链接转义。对不存在的新能力先明确断言失败；与现状等价的保真部分应保持通过。
2. 依次提取 film-context、delivery-inputs、qc-config、command-args，每次保留旧模块具名重导出并更换形成环的内部导入。不合并或重排 loadFilm 的校验，不改变纯参数算法。
3. 先补来源变更失效用例：在隔离引擎副本中修改提取后的 QC 配置或 film-context，旧 QC/交付来源不能仍显示 current/accepted；历史账本和签批字节保留。确认未补新文件身份时用例因错误复用失败。
4. 提取 qc-source，使两个签名使用者共享实现；按规格补全相关指纹文件列表，检查全引擎身份仍覆盖新模块。仅做必要身份失效，不迁移旧证据为成功。新版本内同输入再次执行仍可复用。
5. 运行 `node --test tests/unit/load-film.test.mjs tests/unit/film-compat.test.mjs tests/unit/variants.test.mjs tests/unit/qc-judge.test.mjs tests/unit/delivery.test.mjs tests/unit/final-delivery.test.mjs tests/unit/args.test.mjs tests/integration/architecture-evidence.test.mjs tests/integration/final-delivery.test.mjs tests/integration/main-check-reuse.test.mjs tests/integration/recovery-delivery.test.mjs`。需要真实媒体的测试必须先配置依赖，不能将跳过计入通过。
6. 确认原导出仍可调用、四模块环消失且没有用动态 import 隐藏依赖，按提取/指纹配套分成可独立回退的提交。

## 任务 3：按职责搬移命令处理器（Q1，A2–A4、A8）

依赖：任务 2。涉及：六组 commands、review-artifacts、唯一命令目录与现有入口集成。

1. 用任务 0 的固定命令清单、输出夹具和独立预检矩阵补齐搬移前的行为覆盖；不能只读取新目录然后测试同一目录。复用任务 1 的导入和跨调用测试，已通过的保真测试保持通过；只有发现未覆盖的实际错误时才补充对应红测，不人为制造失败来证明等价搬移。
2. 按 environment/project → media/audio → review/subtitles-final 逐组搬移原处理器，显式传入本次参数及日志函数；当前行为依赖外层变量的地方逐项登记。每组完成就运行对应契约测试，不同时重写业务。
3. signoff 保持 pending-approval、检查、流程存档、交付批准、Git 的既有顺序。final all/主副版和字幕子流程直接调用内部处理器，不能再次进入执行器导致锁重入。报告异常/输出失败也应走原 finally。
4. 每组执行 `node --test tests/unit/cli-contracts.test.mjs tests/unit/cli-lifecycle.test.mjs tests/integration/flow-guard.test.mjs`，再运行对应已有的 brief/new-style/render/subtitles/sfx/recovery-delivery/final-delivery 集成。对同一冻结夹具比较退出码、stdout/stderr 和写入清单；仅归一化明列的路径、时间、随机 ID。
5. 移除搬移造成的无用导入和命令全局状态，改善所涉及长表达式的排版；不格式化无关文件。各组独立提交，最终 bin/wka 不再含媒体/签批编排。

## 任务 4：把结构约束变成持续检查（Q3，A5、A9、A10）

依赖：任务 3。涉及：root package/lock、tools/check-architecture、module-boundaries、三份 CI 与贡献指南。

1. 纯开发配置先精确固定 Acorn 8.19.0 并生成根锁文件；执行 `npm ci --no-audit --no-fund`。这一步是配置准备，不伪造红测；不能从引擎的间接依赖偷取解析器，不能改引擎锁文件。
2. 为检查器先写小型真实文件图的失败测试：直接环、自环、重导出环、字面量动态环、core → CLI、低层经中间模块回到编排层、缺失相对目标、未知动态表达式、空输入、语法错误；正例覆盖注释/字符串中的假 import、合法 node: 和包依赖、两处已有动态入口。运行 `node --test tests/unit/module-boundaries.test.mjs` 确认检查能力缺失导致失败。
3. 最小实现 AST 提取、确定性路径解析、循环与层次检查；错误给出路径/边，不执行所扫描模块。新增 `npm run check:architecture`，作为 `npm run lint` 的一部分；通过所有反例/正例后检查真实引擎零违规。
4. lint/smoke/agent-installation 在需要解析器前增加根 `npm ci`。三平台现有安装、ZIP、文件 I/O 测试保留，再执行 `node --test tests/unit/cli-lifecycle.test.mjs tests/unit/cli-contracts.test.mjs tests/unit/module-boundaries.test.mjs`；这些测试不得依赖 ffmpeg、浏览器、Python 或真实用户项目。严格剪映任务保持原失败/跳过规则。
5. 更新贡献指南的开发初始化和命令边界，更新根 package 描述。运行 `npm run lint`、`node --test tests/integration/desktop-plugin.test.mjs tests/integration/portable-installation.test.mjs`、`npm run build:portable`，从解压后的非仓库目录验证 CLI/清单；检查所有新引擎文件已入包、Acorn 和仓库 node_modules 未进入安装包，提交。

## 任务 5：完整验收与性能保护（A1–A12）

依赖：任务 4，候选运行时代码冻结且工作区干净。交付物：逐项验收报告、原始配对证据、可审阅的本地提交。

1. 记录精确基线/候选/工具提交，验证两份引擎清单与锁一致，准备隔离依赖、字体和媒体工具。基准必须用各自的代码与独立工程/缓存，不使用本机客户作品。基准工具不修改；若结构搬移确实破坏工具的原公开入口，应先修复兼容出口。
2. 以下变量由任务 0/本任务的隔离目录设置，均为绝对路径；每个输出目录必须尚不存在。执行同机 5 轮交替配对：

```bash
node tools/bench-performance.mjs --engine "$phase4_baseline_engine" --candidate "$phase4_candidate_engine" --suite hash --rounds 5 --out "$phase4_hash_out"
node tools/bench-performance.mjs --engine "$phase4_baseline_engine" --candidate "$phase4_candidate_engine" --suite workflow --cases browser-example,remotion-example --rounds 5 --out "$phase4_workflow_out"
```

3. 预期 9 + 12 个场景，210 次正式计时、42 次探针。检查全部结果/摘要、帧数/音频区间、重渲数量与 ffmpeg 工作量，保留全部样本。中位数回退不得超过 `max(100ms, 基线中位数×10%)`；报告 RSS 的主 Node 范围及正常波动。此项不替代第三批原始大音轨证据，也不要求再次整夜跑全 57 场景。
4. 执行 `node --test tests/unit/file-hash.test.mjs tests/unit/source-state.test.mjs tests/unit/operations.test.mjs`：最大读取 1 MiB、一次 sourceState 去重、独立观察和交付双读继续满足。需要 Node 20 的本地兼容检查使用可验证的 Node 20 环境，不能只以 Node 25 结果代替。
5. 执行 `npm test`、`npm run test:jianying`、`npm run smoke`、`WKA_TIMING_LONG=1 node --test --test-concurrency=1 tests/integration/timing.test.mjs`、`npm run lint`、`npm run build:portable`、`git diff --check`。长片开关已按现有 timing 测试核实，报告必须包含两个管线各四种组合，不能把未启用矩阵当已完成。
6. 完整时间轴须覆盖 browser/Remotion、主/副画幅、原规格/小样 107 镜；9 张视觉样张零差异。严格剪映全部实际执行、零跳过；普通回归若有可选剪映跳过，逐项核对专项覆盖，不能仅看总退出码。
7. 逐条填写 A1–A12、命令退出码/数量、静态边与动态入口、指纹变化/旧证据处理、分发文件和性能限制。报告明确本地与远端边界；当前用户已授权实施与本地验收，后续获准开 PR 时再运行当前提交的全部 CI，合并/发布/安装升级仍需相应授权。

## 停止或调整条件

- 原签批或工程文件被意外改写、正常失败仍留自有锁、非预期退出码/输出变化、出现新环或漏掉来源文件，先修复当前任务，不继续搬移。
- 单纯格式清理不能替代验收；结构测试不能只断言文件大小、函数名或复制候选代码的计算结果。
- 发现必须改变业务规则、扩展锁范围、迁移证据 schema、添加用户运行时依赖或改媒体算法时，先更新规格并取得用户确认。
- 只在新增改动、失败或未解决疑点要求时追加验证，不因为不放心重复整套已通过测试。
