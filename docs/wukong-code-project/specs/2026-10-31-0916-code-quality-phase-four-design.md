# 第四批代码质量与架构优化：命令生命周期、无环依赖与结构检查

Status: Merged — all implementation CI passed; v0.19.5 release authorized
Implementation result: [第四批本地验收报告](../reports/2026-10-31-code-quality-phase-four-validation.md)；任务 0–5 与 A1–A12 已完成；PR #120 的三平台及全部 CI 通过并已合并，用户已授权发布 v0.19.5。

Date: 2026-10-31 (Asia/Shanghai)
Spec approval: 用户于 2026-10-31 明确批准本规格与实施计划，并要求从命令失败后的锁清理开始实施
Baseline: `76c0d8a534decec724b72a141cb415ce5b6c506a` / v0.19.4

用户已明确要求“审阅并批准第四批规格与实施计划，从命令失败后的锁清理开始实施。”审阅确认三项范围、八条约束和分步验收一致，无阻碍实施的问题；沿用 [#113](https://github.com/wukongnotnull/wukong-animation/issues/113) 跟踪。前三批分别已发布 v0.19.2、v0.19.3、v0.19.4，第四批已完成实施与本地验收，实际结果见验收报告，后续远端 CI 与合并结果已补入报告。

## 1. 问题与目标

继续遵守可靠性优先、分批落地的已确认原则。本批的价值是降低漏接保护、改错调用方向和遗漏证据失效的风险，不承诺新增制作功能或渲染提速。

### 已核实事实

| 编号 | v0.19.4 证据 | 本批目标 |
| --- | --- | --- |
| Q1 命令生命周期 | `bin/wka.mjs` 共 663 行、22 个命令分支，同时解析参数、取锁、登记命令、编排媒体和签批、格式化输出。`execute` 的命令清单与 `main` 分支分别维护。`fail` 调用 `process.exit(1)`，可绕过外围 finally。 | 将命令策略与处理器放在一份显式目录中，集中执行保护和清理；保留命令契约，消除受控错误留下锁的问题。 |
| Q2 循环依赖 | 用现有锁定 Acorn 8.19.0 解析 Git 跟踪的 60 个引擎 `.mjs`，确认一组四模块强连通分量：`job`、`final-delivery`、`delivery`、`qc`。例如 `job → final-delivery → job`，以及 `delivery ↔ final-delivery`。 | 抽出已有的低层职责，打断这组静态依赖环；保留原公开导出，不重写整个最终交付模块。 |
| Q3 结构回退缺少检查 | 当前 `npm run lint` 检查清单、风格、技能和生成文档，没有模块依赖方向或循环检测。`core/delivery.mjs` 反向引用 `bin/args.mjs`。拆分后的代码还必须进入现有指纹范围。 | 增加精确、可测试的架构检查，禁止环和反向引用；为提取代码的指纹变化增加回归用例。 |

Q1 已做隔离诊断：在新建空目录执行 `wka signoff <临时目录> "invalid-step probe" --step 999`，退出码 1、错误 `✗ --step 取 1–15`，随后仍存在 `.cache/operation.lock` 与 `.cache/active-command.json`。该诊断未改仓库或客户工程，临时目录已删除。旧锁可由下一次同机命令识别死进程后恢复，因此这里不宣称永久死锁；目标是正常错误路径主动释放自己持有的锁。命令恢复记录继续保留。

静态依赖观察同时发现两个非字面量动态入口：`core/registry.mjs` 的插槽加载、`audio/soundtrack.mjs` 的用户构建脚本加载。它们是现有扩展机制，不把静态无环宣称为任意外部脚本也无环。

### 收益、成本与取舍

| 工作 | 收益 | 主要成本与验证 |
| --- | --- | --- |
| Q1 | 失败也走清理；新增命令无需另记一份写入清单；处理器可独立导入核验 | 涉及全部命令的搬移，先冻结输出/退出码/副作用，再逐组迁移；不改参数语法。 |
| Q2 | 读工程不再经渲染/交付循环回到自身；低层输入可单测 | 新增少量职责明确模块；必须保留旧导出并覆盖移出代码的指纹。 |
| Q3 | CI 能指出具体循环路径、违规导入和新增不透明动态加载 | 仅仓库开发依赖新增锁定解析器；不向用户安装包增加运行时依赖。 |

不采用全仓 TypeScript 迁移、通用命令框架或全量格式化：它们扩大审阅差异，却不是解决以上已核实问题所必需。本批不继续拆散最终交付报告、音频、渲染调度等独立子系统；如后续发现新需求，另行评估，不预先安排第五批。

## 2. 架构与组件边界

### Q1：入口、执行器与命令处理器

- `bin/wka.mjs` 保留原路径和 shebang，只接收真实 argv、调用执行器、设置最终退出码。正常失败不调用 `process.exit`。
- `cli/run.mjs` 暴露内部接口 `runCli(argv, { log, error } = {}) -> Promise<number>`，统一解析、查找命令、流程版本预检、取得锁、登记 active-command、await 处理器、finally 释放锁、输出单次错误。它不在导入时自动执行，也不改进程的 argv/cwd/exitCode。
- `cli/commands.mjs` 维护唯一的命令目录。每条包含处理器及明确的预检目标、加锁条件、是否登记 active-command；允许少量基于参数的条件函数，不设计通用插件注册机制。
- `cli/commands/` 按 environment、project、review、media、audio、subtitles-final 六组搬移已有处理器。跨组共享的审阅登记/字幕辅助函数仅提取到 `cli/review-artifacts.mjs`，不建任意服务容器。核心模块不导入这些 CLI 模块。
- 帮助正文转入 `cli/help.mjs`，保留原文本与别名行为。参数读取和错误辅助函数可置于 `cli/context.mjs`；校验失败抛异常，由执行器输出，不能在处理器内部退出进程。
- handler 接收本次调用的 `{ pos, opt, log }` 等明确上下文，不读取模块级共享命令状态。主副版、终版递归调用和字幕内部步骤不得再次进入外层执行器或重复取得同一工程锁。

已有策略必须按下表搬移，不能顺手扩大锁范围或写入范围：

| 命令类别 | 流程预检 | 工程锁 | active-command |
| --- | --- | --- | --- |
| signoff/qc/still/animatic/render/preview/clean/soundtrack/subtitles/final | 第一个位置参数指定的片目录 | 有目录参数时取得 | 有目录参数时登记原始 argv |
| delivery（普通或 --final） | 片目录；报告命令也可能写报告 | 仅 --final 且 --record 时取得 | 不登记 |
| audition；sfx 不带 --list | 片目录 | 不新增锁 | 不登记 |
| sfx --list | 保持原行为 | 不取得 | 不登记 |
| brief/init | `--dir` 下 films/片名，仍在创建前预检 | 不新增锁 | 不登记 |
| init-project | 项目内工程统一预检 | 不新增锁 | 不登记 |
| status/resume | 保留原只读诊断路径 | 不取得 | 不登记 |
| setup/check/list/new/help/无命令/未知命令 | 保留各自既有目标与校验，不误当片目录写入 | 不取得 | 不登记 |

对已取得锁后的同步校验错误、异步拒绝和正常返回均执行释放。保留 active-command 和失败恢复证据；取锁失败时不释放别人的锁、不写 active-command。SIGKILL/进程崩溃继续走现有陈旧锁恢复，不新增信号处理器，也不承诺强杀时执行 finally。

### Q2：提取共享低层能力

| 新模块 | 从何处提取 | 依赖限制与兼容出口 |
| --- | --- | --- |
| `core/film-context.mjs` | job 的 loadFilm | 可用 state/registry/resolver/variants/字幕样式等现有低层能力，不可到达 job、qc、delivery、final-delivery 或 CLI；job 保留 loadFilm 具名重导出。 |
| `core/delivery-inputs.mjs` | delivery 的 fileLink/readDecisions/decisionConflicts | 使用 film-context 和原验证器；不依赖报告/账本编排；delivery 保留三个导出及既有 finalDeliveryReport/writeFinalDelivery 重导出。 |
| `core/qc-config.mjs` | qc 的 QC_DEFAULTS/qcConfig | 纯数据合并，不读写文件、不调用媒体工具；qc 保留 qcConfig 导出，judgeFrames/runQc 等不搬移。 |
| `core/command-args.mjs` | bin/args 的 parseArgs | 保留当前参数算法；bin/args 成为兼容重导出，delivery 不再导入 bin。 |
| `core/qc-source.mjs` | qc 与 final-delivery 两处同形 QC 来源签名 | 同一个函数计算签名，依赖证据读取和路径基础模块，不导入 qc 或最终交付编排。 |

改为 `job → final-delivery → delivery-inputs/film-context/qc-config/qc-source`；`delivery → final-delivery` 的兼容导出继续存在，但 final-delivery 不再回引 delivery、job 或 qc。完成后，引擎自有 `.mjs` 的字面量本地依赖图不得有环。

仅替换为新低层导入的调用点允许发生结构变化；loadFilm 的版本保护、字段迁移、重复镜头拒绝、镜头顺序、路径、画幅覆盖和字幕样式合并保持原样。

### Q2 的必要配套：指纹覆盖

不能只搬走代码，却仍仅哈希旧文件。本次逐项记录“移动前归属 → 移动后文件 → 使用该身份的生产者/校验者”：

1. operations/main-check 的全引擎身份继续覆盖新增引擎模块，不缓存跨次观察，也不排除新 cli/core 文件。
2. 最终交付的 renderer/encoding 实现投影补入从 job 移出的 film-context 等实际相关文件；保留原分组、字段语义和独立取证，不把开发工具目录纳入用户证据。
3. QC 来源签名的生产者和最终交付校验者统一使用 qc-source；算法身份覆盖 `qc.mjs`、`qc-config.mjs`、`qc-source.mjs`，以稳定顺序和相对标识组成摘要。视频/时间轴仍取真实内容摘要。
4. 新签名不伪装成旧签名。旧缓存或逐文件批准可能需要重新核实，原账本、历史、用户签批和成品必须保留；不得迁移成“已通过”来隐藏实现变化。新代码下相同输入连续运行仍应正常复用。

## 3. 接口、数据与行为

- 22 个现有命令、help/--help/无命令、参数默认值、`--x value`/`--x=value`、负值、空值、位置参数和未知选项的既有处理不变。不引入新的严格参数解析规则。
- 退出码保留 0（成功/帮助）、1（错误）、2（QC 或交付尚未完成的业务结果）；stdout/stderr 分工、中文错误前缀、帮助正文和 JSON 结构不变。路径、时间、随机 ID 等仅在测试比较中按明确字段归一化，不掩盖其他差异。
- 错误返回的唯一预期修正是正常受控失败会释放当前命令持有的锁；不删除恢复记录或用户文件。异步任务必须 await 完成后退出，错误只输出一次。
- `job.loadFilm`、`qc.qcConfig`、`delivery` 的现有导出和 `bin/args.parseArgs` 仍可按原路径导入；新低层模块只供内部复用，不要求技能或第三方改导入路径。
- 工程 JSON、FLOW、TIMING_VERSION、交付 schema、产物命名、镜头缓存键的算法/格式和用户审阅流程不升版；实现摘要可随代码变化而改变，按现有规则使相关缓存或证据失效，不承诺升级前后摘要相同。

## 4. 约束、兼容性与非目标

以下八条是计划必须原样继承的全局约束：

1. 保持 Node.js 20+、browser/Remotion、原生与便携分发；不新增用户运行时依赖，不改变引擎锁文件。
2. 保持 22 个命令、原参数语义、退出码、输出结构和旧模块公开导出；受控错误释放当前锁是本批明确的行为修正。
3. 流程版本保护先于锁、active-command、账本、报告及 Git 写入；--force 不绕过保护，失败不覆盖用户素材、作品、签批和暂存内容。
4. 保留原命令的锁范围、取证顺序和独立复读；不跨 await 或跨调用复用来源观察，不削弱最终交付双遍扫描。
5. 所有移出代码都必须纳入相应实现指纹；允许旧证据按现有规则变为待核实，不伪造通过、不改写历史批准。
6. 只做必要提取及涉及代码的清晰排版，不全仓格式化、不迁移 TypeScript、不引入通用框架，不重写音频/渲染/最终交付整个子系统。
7. 保留完整回归、严格剪映、9 张视觉样张与三平台检查；不跳过、删除或放宽既有断言，不更新视觉基准。
8. 规格和计划已于 2026-10-31 获用户批准，按计划实施；PR、合并、发布和本机安装升级另按后续授权执行。

### Q3：开发期结构检查

- 根 package.json 新增精确固定的 **Acorn 8.19.0** 开发依赖并提交根 package-lock.json；版本已从当前引擎锁文件及已安装包核实。解析器仅供仓库检查，不依赖引擎 node_modules 中的间接依赖，不加入 plugin/engine 的清单或发布包。
- 新增 `tools/check-architecture.mjs`，解析 Git 跟踪的引擎 `.mjs`：检查静态 import、带 source 的 re-export、字符串字面量动态 import；报告不存在的本地目标、循环的完整路径和违反层次的边。
- 禁止 core 指向 bin/cli；禁止新低层模块经传递依赖回到上层编排；CLI 处理器不能直接调用 process.exit，执行器/处理器不能在模块导入时启动命令。后两项结合语法检查和真实导入测试验证，不宣称静态分析证明所有副作用。
- 非字面量动态 import 仅登记现有 registry 插槽与 soundtrack 用户脚本两处明确用途。新增不透明入口必须显式更新设计和检查规则；不允许用动态 import 绕过层次限制。测试覆盖注释、字符串、重导出、字面量动态导入、空扫描和自环，不能用正则假装完整模块解析。
- `npm run lint` 保留原检查并追加结构检查；新增测试仍由 npm test 收集。需要它的 lint/smoke/三平台任务安装根开发锁依赖，严格剪映任务保留独立必跑属性。贡献指南区分根 `npm ci`（开发检查）与 `npm run setup`（制作依赖）。

## 5. 错误处理与运维

本批按独立提交顺序实施：先失败清理，再低层提取，随后搬移命令和加入最终结构门禁。出问题回退对应提交，不靠删除作品或升级证据 schema 恢复。CLI 输出发生非预期差异、旧入口失效、出现新循环、签名漏掉移动代码或检查强度下降，均停止后续搬移并修复。

解析器安装失败、扫描目标为空、解析失败、未知动态加载、违规依赖或循环必须非零退出并指出文件与原因。架构检查本身不执行引擎命令、不初始化用户目录、不调用媒体工具。

性能验收复用第三批工具：9 个哈希场景 + browser/remotion 两个 example 的 12 个流程场景，双方各 5 轮交替计时、各 1 轮独立探针，共 210 次正式计时、42 次探针。冻结 v0.19.4 与候选、同依赖同环境，禁止跨引擎复用暖缓存；门槛仍为 `max(100ms, 基线中位数×10%)`。这是本批代表回归，不重复宣称完成第三批 57 场景全矩阵；大音轨 1 MiB 读取上限、单次状态去重和交付双读由确定性测试继续约束。发现超门槛变化先定位，必要时另提追加测量，不将共享 CI 的墙钟用作硬性提速目标。

## 6. 验收标准与测试

| ID | 验收条件 | 证据 |
| --- | --- | --- |
| A1 | 原始 `signoff --step 999` 症状退出 1 且无遗留自有锁；active-command 保留；正常返回/同步异常/异步拒绝均释放一次，取锁失败不释放别人 | cli-lifecycle 的真实临时工程及定向故障注入；先在 v0.19.4 失败 |
| A2 | runCli 可独立导入、连续调用互不污染；不自动运行、不改 process.argv/cwd/exitCode；入口 await 后设置退出码 | 独立进程导入、连续两次不同命令及输出/文件观察 |
| A3 | 22 命令与别名、参数、0/1/2、JSON/帮助/错误流兼容，预检/锁/active-command 策略与上表一致 | 冻结的独立命令表与 subprocess 测试；原 args/unknown-command/媒体集成继续通过 |
| A4 | 未来/非法流程在任何副作用前拒绝，原签批/Git/index/外部草稿保留；--force 不绕过 | 既有 flow-guard 与 recovery-delivery；补齐搬移后的入口 |
| A5 | 原四模块字面量依赖环消失；core 不再引用 bin/cli，新低层模块不能回到编排层 | 完整 `.mjs` 图与精确违规边；假循环/重导出/动态字面量反例先红后绿 |
| A6 | loadFilm/qcConfig/parseArgs/交付输入的原路径兼容、结果与错误一致；主副版/缺失文件/重复镜头/字幕覆盖不变 | 旧新出口行为比较，既有 load-film/variants/qc-judge/delivery 等测试 |
| A7 | 修改提取后的 film-context 或 qc-config/qc-source 会使对应旧证据失效，生产者与校验者一致；旧历史文件不改，新版本内复跑可复用 | 隔离引擎副本修改来源字节；真实 QC/交付链、账本摘要与重复执行检查 |
| A8 | 最终报告仍只写规定的报告，签批与手改草稿保护、退出 2、未知来源处理及独立双遍读取保持 | final-delivery 单测/集成、严格剪映、source-state/file-hash 及恢复测试 |
| A9 | 结构检查遇到空输入/语法错误/缺失目标/违规边/新动态入口失败；注释/字符串不误报；三平台可执行 | checker 夹具与 Node 20 Windows/Linux/macOS；失败不是 skip |
| A10 | 新模块进入原生与便携包；根开发依赖不进入包，非仓库目录 CLI 可运行；已安装渠道不依赖开发目录 | desktop-plugin、portable-installation、ZIP 解包后运行命令 |
| A11 | 21 场景配对无超阈值回退，媒体帧数/音频区间与重渲工作量相同；第三批硬性 I/O 边界保留 | 210 计时/42 探针、原始日志与 JSON，不删除慢样本 |
| A12 | 完整 npm test、严格剪映、9 样张零差异、107 镜时间轴矩阵、lint、打包和当前提交 CI 全过 | 报告分别列本地/远端结果和跳过覆盖，不将 Windows 文件 I/O 称为 Windows 渲染验收 |

审批时证据为代码核对、静态图和隔离错误诊断；上述 A1–A12 是实施验收目标，批准不代表已通过，实际结果以实施报告为准。
