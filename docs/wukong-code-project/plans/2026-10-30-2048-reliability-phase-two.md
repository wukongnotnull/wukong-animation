# 第二批可靠性优化实施计划

Status: Implemented and verified — PR #116 pending merge

目标：按[已批准规格](../specs/2026-10-30-2045-reliability-phase-two-design.md)交付锁定依赖安装、较新流程保护和剪映必跑 CI，逐项验证 A1–A12。

架构：依赖身份、安装完成凭据和解析根在现有 paths/deps 周围收敛；工程版本规则统一在 state，由 CLI 和共享制作入口在写入前调用。剪映通过独立 workflow 和严格测试运行器成为单独的 CI 检查，不新增制作框架。

技术栈：Node.js 20+ ESM、node:test、npm ci、JSON/SHA256、临时文件与原子重命名、现有 Git/ffmpeg/Chromium；剪映任务使用 Ubuntu、Node 20、Python 3.11、pyJianYingDraft 0.3.1。

基线 `abfd4f0319263f84f8f690cc30bf8a6820817a2e` / v0.19.2。关联 [#113](https://github.com/wukongnotnull/wukong-animation/issues/113)。用户于 2026-10-30 批准规格并要求从依赖锁定开始实施；初稿文档检查记录保留，不代表功能已经通过验收。

## 全局约束（原样摘自规格）

- 本批不改变画面、帧率、声音、字幕、主副版关系、15 道工序或 12 个审片节点。
- 测试只使用临时工程、临时用户目录与临时剪映草稿目录，不修改客户作品、已安装插件缓存或真实剪映草稿。
- 不升级现有 npm 依赖，不新增 Manim/Blender，不做第三批性能算法或核心整体重构。
- 本轮实施已批准的第二批规格；不发布补丁、不升级已安装插件，也不修改客户作品。
- 不把 Linux 自动化草稿检查当作剪映桌面实际打开、字幕观感或所有宿主兼容的证明；既有 macOS 剪映 11.6 的人工验收边界继续保留。
- 依赖隔离会带来一次重装及额外磁盘占用；旧目录保留、不自动垃圾回收。用户已随规格批准此兼容代价。
- 较新流程保护不引入自动降级、用户文件修复或 `--force` 绕过；已知旧流程迁移规则保持原语义。

## 文件与职责

下列新增文件名为建议落点；实施时可在相同边界内合并小模块，不得因此省略验收要求。

| 修改/新增文件 | 职责 |
| --- | --- |
| `plugin/engine/core/paths.mjs` | 用户依赖目录根；保留其他用户资源路径 |
| 新增 `plugin/engine/core/dependency-manifest.mjs` | 按需解析清单/锁、计算身份、检查版本与完成凭据；纯计算不依赖 paths，避免循环加载 |
| 新增 `plugin/engine/core/setup.mjs` | 临时目录安装、固定 Playwright CLI、成功发布、失败清理与同身份互斥 |
| `plugin/engine/core/deps.mjs` | 同一依赖根解析，限制路径边界，准确传播错误 |
| `plugin/engine/bin/wka.mjs` | 接入 setup/check，提前解析写入目标与流程兼容性；status/resume 诊断 |
| 新增 `tools/stamp-deps.mjs`、根 `package.json` | 仓库 npm ci 成功后检查并登记开发依赖凭据；新增严格剪映测试命令 |
| `plugin/engine/core/state.mjs` | 流程版本错误、无副作用检查、旧版迁移和混合项目扫描 |
| `plugin/engine/core/job.mjs`、`operations.mjs`、`delivery.mjs`、`final-delivery.mjs` | 为共享制作/报告/账本入口接入统一保护，不复制流程规则 |
| 新增 `tests/unit/deps.test.mjs`、`setup.test.mjs`、`tests/integration/setup.test.mjs` | 身份、解析、失败安装与真实安装契约 |
| `tests/unit/state.test.mjs`、`operations.test.mjs`、`final-delivery.test.mjs`；新增 `tests/integration/flow-guard.test.mjs` | 流程版本与写入前拒绝；保留旧版迁移、签批及恢复回归 |
| 新增 `tools/test-jianying.mjs`、`tests/unit/jianying-runner.test.mjs` | 指定测试集合、依赖预检、无跳过/无空执行的严格计数与退出状态 |
| 新增 `tests/requirements-jianying.txt`、`.github/workflows/jianying.yml` | 固定 Python 包版本与独立 CI 环境 |
| `tests/integration/jianying.test.mjs`、`final-delivery.test.mjs`、`tests/unit/jianying-fonts.test.mjs` | 保留真实导出集合；必要的测试辅助抽取，不降低覆盖或放宽断言 |
| `tests/integration/desktop-plugin.test.mjs`、`portable-installation.test.mjs` | 新安装契约与分发资源闭合性 |
| `plugin/skills/setup/SKILL.md`、`docs/ARCHITECTURE.md`、`docs/CONTRIBUTING.md` | 依赖隔离、首次 setup、开发安装入口及严格 CI 用法 |
| 新增验证报告（实施当天日期） | 失败/通过证据、A1–A12 对照、实际 CI 与未验证边界 |

## 顺序与拆分

任务 1 → 2 完成 R4；任务 3 → 4 完成 R5；任务 5 → 6 完成 R6，最后任务 7 统一验收。R5 与 R4 逻辑独立，但本计划按顺序实施，避免同时改 CLI。每项先留失败证据、最小实现再提交；没有用户新的要求时，不自行启用子代理或并行改文件。

优先保留为三个可独立审阅的实现提交组，后接一组验证文档。若实现暴露必须改变规格的情况，先修订规格并等待批准，不直接扩写需求。

## 任务 1：锁身份与单一依赖根（A2、A4）

交付物：可验证的依赖身份、完成凭据检查、requireDep/resolveDep 使用同一根。涉及 paths、dependency-manifest、deps 和依赖单测。没有前置实现依赖。

1. 写失败测试：同 engineVersion 的不同清单/锁、平台/架构/Node 主版本；旧共享目录与父级包诱饵；用户根缺包/加载错误而开发目录有同名包；两个解析 API 来源一致。
2. 运行 `node --test tests/unit/deps.test.mjs`，确认旧实现因为目录碰撞、无凭据仍可复用或跨根回退而失败，保存具体断言输出。
3. 最小实现：身份按需计算，凭据匹配后选择一次根；包实际路径约束在该 node_modules 下。缺包/加载异常保留原因；hasDep 只负责存在性结果，不伪造 check 成功。
4. 重跑上述命令，覆盖合法开发依赖与用户依赖、同名 React/Remotion 的来源；确认无按帧扫描包树的逻辑。
5. 提交 `fix(deps): isolate locked dependency identities and resolution`。

接口产出：清单/锁身份计算、完成凭据校验、统一依赖根选择；具体导出名称由实现确定，但不把测试参数变成生产 CLI 绕过开关。

## 任务 2：原子安装及三种分发路径（A1、A3、A5）

交付物：用户 setup 与仓库 setup 均安装同一锁，失败不替换好环境。依赖任务 1；涉及 setup、CLI、仓库 stamp 工具、文档与安装集成测试。

1. 写失败测试：复制清单/锁字节；捕获实际启动的 npm 参数；缺锁/损坏/失配；npm 失败、Chromium 失败、安装中断、同身份并发；旧目录/其他身份目录保留；仅缺浏览器时补装。
2. 运行 `node --test tests/unit/setup.test.mjs tests/integration/setup.test.mjs`，确认旧代码使用 npm install、未复制锁文件且可写入共享旧根等行为触发失败。
3. 实现临时安装及完成凭据发布，使用安装根内的 Playwright CLI；不以 npx 触发临时依赖下载。仓库 setup 保留 npm ci 位置，成功后用 stamp 工具登记开发凭据。
4. 重跑定向测试，再执行 `npm run setup`，验证开发凭据和现有 esbuild/Remotion 测试仍能解析包。
5. 在临时 `WUKONG_ANIMATION_HOME` 中对干净原生插件副本与便携包分别运行其 `engine/bin/wka.mjs setup`、`check`。至少一次使用真实 npm ci 和浏览器安装，核对实际直接包版本、锁摘要、目录身份及插件副本文件摘要；同身份二次运行应复用。
6. 运行 `node --test tests/integration/desktop-plugin.test.mjs tests/integration/portable-installation.test.mjs`；临时目录的创建/删除由测试明确归属，任何命令不得操作当前已安装插件。
7. 提交 `fix(setup): install published lockfile without replacing valid environments`。

验证限制：故障注入证明失败处理，真实安装证明锁文件与包管理器契约；二者不能相互替代。新目录、旧目录、开发根三种情况分别检查，不把本机已有完整依赖作为“干净安装”证据。

## 任务 3：流程版本判定与只读诊断（A6、A7）

交付物：未来/非法 flow 不迁移，status/resume 提供可脚本识别的诊断。涉及 state、CLI、final-delivery 中现有 migrateProgress 使用方与状态测试；不依赖 R4 行为。

1. 在 state 测试中增加 flow 6/99、显式非法类型、缺字段和历史字段保留；记录输入对象和磁盘原始字节。新增混合项目扫描及 resume JSON 情景。
2. 运行 `node --test tests/unit/state.test.mjs tests/integration/flow-guard.test.mjs`，应因旧实现把 flow 6 回写为 5、重新解释历史等原因失败。
3. 将版本判定集中在 state；已有 1–4 迁移代码只在确认旧版后执行。未来版本返回统一错误，listProductions 对单片错误输出兼容性记录，status/resume 在不写未来工程的情况下诊断。
4. 同命令通过；特别回归已有 17 项 state 用例、flow 4 小样/字幕交换、批准 ID 幂等及 approved/mainId 保留。
5. 提交 `fix(state): reject newer flow versions without rewriting progress`。

接口产出：无副作用的影片兼容性检查与两个稳定错误码；状态列表正常项结构保持兼容，不兼容项明确区分，不靠缺少 nextLabel 猜测状态。

## 任务 4：所有制作入口先拒绝再写入（A8、A9）

交付物：CLI 和共享入口在任何制作副作用前挡住不支持的流程。依赖任务 3；涉及 CLI、job、operations、delivery/final-delivery 及集成测试。

1. 扩充临时工程表驱动用例，逐个覆盖规格列出的写命令；对 brief/init 使用其实际目标 films/<name>，对 init-project 构造含未来流程的真实 Git 项目。覆盖 `--force`、delivery 的普通/final/record 三种形式，以及没有 film.json 的 brief 占位片。
2. 为 state、缓存、账本、review、外部草稿设置哨兵并记录路径集合、字节、Git index blob/mode 和 HEAD；另设不存在的目录，防止只检查旧文件而漏掉新增文件。
3. 运行 `node --test tests/integration/flow-guard.test.mjs tests/unit/operations.test.mjs tests/unit/final-delivery.test.mjs`，确认原路径先建锁/active-command、报告或待签批文件而失败。
4. 在 execute 的副作用前进行目标解析与统一预检；brief/init/init-project 使用正确目标。共享 loadFilm、状态写入、阶段及报告公开入口复用同一检查。若必要取锁后二次检查，但不改变原锁所有权规则。
5. 同命令通过；用子进程诱饵确认未启动渲染/编码，使用实际文件系统和 Git 断言确认零制作改动。正常 flow 5 命令、仅查看信息的命令和旧版迁移继续通过。
6. 提交 `fix(cli): guard production writes before locks and side effects`。

不靠仅断言错误字符串通过；必须核对副作用。保护边界限定本插件提供的 CLI/共享制作入口，不声称阻止用户手工改文件或任意第三方脚本写入。

## 任务 5：严格剪映测试入口（A10、A11）

交付物：`npm run test:jianying` 有真实用例结果，不能跳过后成功。涉及运行器、requirements、根 package scripts 与运行器单测；真实测试复用现有文件。

1. 用临时测试文件构造 pass/fail/skip/todo/空文件/文件不存在，以及依赖预检失败，新增 `tests/unit/jianying-runner.test.mjs`。
2. 运行 `node --test tests/unit/jianying-runner.test.mjs`，旧入口不存在或 skip 仍成功时应失败，明确记录实际红灯原因。
3. 实现 Node 20 可用的结构化测试结果消费；固定生产测试文件集合，报告逐文件和全局结果。任一 skip/todo/cancel/fail 或零用例即非零，不能吞掉子进程退出码。测试夹具只能通过内部测试接口注入，不能让 CI 默认集合被环境变量清空。
4. 预检检查 Python 符合依赖支持范围（当前包要求 >=3.8）、pyJianYingDraft 精确 0.3.1、ffmpeg/ffprobe 和可用 browser；CI 固定 Python 3.11，本地不强制卸载其他受支持 Python。
5. 运行 `node --test tests/unit/jianying-runner.test.mjs` 全通过，再运行 `npm run test:jianying`，当前三文件基线 19 项应全部执行，skip/todo/fail/cancel 为 0。实际新增用例以发现结果为准。
6. 在隔离子进程环境模拟缺依赖，严格入口必须失败；普通 npm test 的明确可选跳过行为保持不变。
7. 提交 `test(jianying): fail required export checks on missing coverage`。

## 任务 6：独立 CI 配置与实跑（A12）

交付物：每次 push/PR/手动触发均出现并执行 `jianying` job。依赖任务 2、5；涉及 workflow 和贡献文档。

1. 按明确安装清单创建 Node 20/Python 3.11 隔离环境；安装固定 requirements、ffmpeg/字体/MediaInfo 运行库、仓库锁定 npm 依赖及 Chromium。确保运行器调用的 python3 就是该 Python 环境。
2. workflow 设置 push/pull_request/workflow_dispatch、稳定 job 名、有限超时、无路径过滤和无 continue-on-error；保留原 smoke 与三平台安装检查，避免扩大现有任务的可选依赖要求。
3. CI 缓存仅加速安装，不替代预检；在失败时保留日志和计数。工作目录及草稿路径使用 runner 临时目录。
4. 本地运行 `npm run lint`、`npm run test:jianying`、`git diff --check`，检查 YAML 与 npm 脚本入口一致；配置变更不编写仅匹配 YAML 字符串的伪测试。
5. 提交 `ci(jianying): require real draft integration checks`。在用户批准实现后的交付阶段提交 PR，检查 push 与 PR 两次任务；手动触发一次 workflow_dispatch，并检查冷/热缓存行为。记录 SHA、run/job URL、真实计数与耗时。
6. 如果首次 Linux 实跑暴露系统库/版本差异，先记录错误和根因，再最小补齐环境；不得注释测试、改 skip 或放宽草稿断言。不改 GitHub 分支保护；交付记录中明确 workflow 与服务端保护的区别。

## 任务 7：整体回归、审阅与证据

1. 逐项核对 A1–A12，补齐文档：用户第一次需 setup、旧目录保留、开发安装方式、兼容性错误和独立剪映入口。所有指令使用实际插件根，不写死用户机器路径。
2. 在包含本批全部改动的同一提交上运行：

   ```bash
   npm test
   npm run test:jianying
   npm run smoke
   npm run lint
   npm run build:portable
   git diff --check
   ```

3. 本地具备完整依赖时记录完整测试数量和所有跳过原因；严格剪映集合必须零跳过。视觉检查沿用现有 9 张样张，不更新基准图。检查 ZIP 运输后的锁文件、依赖模块与安装入口完整性。
4. 检查差异只覆盖批准规格，验证旧 flow 1–4、正常 flow 5、已批准快照、混合项目、开发依赖与安装插件路径的兼容性。若源码/锁再次变化，重跑受影响检查，不复用旧提交的通过结论。
5. 保存验证报告，附上失败 → 通过证据、A1–A12 映射、本地/CI 区别和未验证事项；更新 #113。以实际 CI 成功作为实现交付证据。
6. 实施交付 PR 描述链接获批规格和计划，并注明本批跟踪关系；合并、发布和升级安装按届时授权执行。

## 初稿阶段文档完成标准（历史记录）

- 两份文件都明确为待批准草案，计划内约束与规格原文一致。
- 三项要求均有现状证据、组件边界、错误行为、兼容代价和可执行验收；R4/R5/R6 各自可独立审阅。
- 检查内部链接、验收编号、占位符和自相矛盾的说法；仅有文档差异，没有运行时代码/测试/workflow 修改。
- 既有 state 基线 17 通过与未来 flow 被改写的隔离复现分开记录，不把基线通过当成修复完成。

任务 1–7 已顺序实施，失败回归、真实安装、完整测试及三种 CI 触发证据见[验收报告](../reports/2026-10-30-reliability-phase-two-validation.md)。推荐下一步：审阅 PR #116 后按后续授权合并、发布；本批没有升级已安装插件。
