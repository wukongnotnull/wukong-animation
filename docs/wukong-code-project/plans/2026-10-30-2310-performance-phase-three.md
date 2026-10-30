# 第三批性能优化实施计划

Status: Approved — implementation in progress
Spec: [已批准第三批性能规格](../specs/2026-10-30-2309-performance-phase-three-design.md)
Baseline: `5957b73e90f014011fb27d3e015d4987c39db6ba` / v0.19.3

目标：用可复跑基准验证并减少大文件哈希内存及单次状态扫描的重复读取，保持制作结果和校验强度。

架构：先建立与制作流程分开的开发测量入口；再以小型同步分块哈希原语替换四处整文件哈希。摘要复用只存在于单次 sourceState 的同步观察中，其他阶段与交付双遍扫描继续独立读盘。

技术栈：Node.js 20+ ESM、node:test、node:fs、SHA-256、现有 browser/Remotion、ffmpeg/ffprobe、固定依赖和隔离 Git 副本。顺序实施，不新增代理并行任务。

本计划初稿按用户要求与规格同时整理；用户于 2026-10-30 明确批准这两份文件并要求从基准工具和真实测量开始实施。沿用 [#113](https://github.com/wukongnotnull/wukong-animation/issues/113) 跟踪，不另建重复 issue；本轮不推送/开实现 PR。

## 全局约束（原样摘自规格）

- 画面、声音、字幕、累计帧切点、画幅、终稿品质、小样规格、worker 默认值和既有 CLI 含义保持不变。
- 完整解码检查、交付双遍扫描、用户签批、未知来源阻断和较新流程写入保护不得减少或绕过。
- 本批不新增全局或磁盘摘要缓存，不用 mtime/size 代替跨调用的内容核对，不跨 await/写入复用观察。
- 不新增渲染管线，不增加并发，不默认使用硬件编码，不升级依赖，不整体异步化，不做无证据的大规模重构。
- 所有测试和基准使用可确认归属的临时副本；不修改客户作品、已安装插件缓存或真实剪映草稿，不清理系统缓存与旧依赖。
- 本轮实施已批准的 P1/P2/P3，合并/发布/安装升级不在本轮范围。

## 文件与职责

文件名为批准后的建议落点，实施中可在同一职责内调整；不能因此扩大去重范围或减少验收。

| 新建/修改 | 职责 |
| --- | --- |
| 新建 `tools/bench-performance.mjs`、`tests/fixtures/performance.mjs` | 构造合成文件/长片、复制仓库例片、串行运行两份引擎并保存原始数据；统计与计时分开 |
| 新建 `tests/unit/performance-benchmark.test.mjs` | 测量输入、场景隔离、轮次、失败计数、进程清理和汇总契约，用廉价夹具验证，不在单测里跑完整基准 |
| 新建 `plugin/engine/core/file-hash.mjs` | 有界同步字节读取与原始字节输入已有 Hash；不含持久缓存或业务判定 |
| 修改 `core/evidence.mjs`、`core/cache.mjs`、`core/timing.mjs`、`core/final-delivery.mjs` | 接入分块哈希，保持外部返回值和证据格式；不动文本解析读取 |
| 修改 `core/operations.mjs`，必要时 evidence 可选读取器 | sourceState 局部观察与重复内容哈希去重，默认调用者不变 |
| 新建 `tests/unit/file-hash.test.mjs`、`tests/unit/source-state.test.mjs` | 有界读取、短读/错误、指纹兼容、观察生命周期及读取量断言 |
| 修改 `tests/unit/shot-hash.test.mjs`、`render-performance.test.mjs`、`final-delivery.test.mjs`、`operations.test.mjs` | 原语接入与业务保护回归；保留所有既有断言 |
| 按实际缺口补充 `tests/integration/render-performance.test.mjs`、`recovery-delivery.test.mjs` | 无改/单改的重渲工作量、恢复、签批和输出保护 |
| 修改 `.github/workflows/agent-installation.yml` | 现有 Node 20 三平台任务追加 file-hash/source-state 纯文件 I/O 单测，不改变剪映必跑任务或分支保护 |
| 后续报告、`docs/CONTRIBUTING.md`、`docs/ARCHITECTURE.md` | 基准操作说明、结果和限制；校准文档中仍写“默认两个页面”的旧表述，说明现有日常 1 / 终稿最多 2 的规则，不改变默认值 |

## 任务 0：批准与冻结范围

依赖：用户明确批准上述规格文件及本计划。

1. 检查 main/工作区状态，记录实际基线；若批准时基线变化，先复核对规格的影响。
2. 更新规格/计划批准状态，只保留本批 P1/P2/P3。确认固定依赖身份与测量环境，不把本轮 27 次合成诊断当作真实制作基准。
3. 保留当前源码的干净 Git 副本，基线和候选安装位置分离；不从客户作品直接运行基准。

交付：已批准规格、版本与环境记录。没有批准，不执行任务 1 及以后的实现。

## 任务 1：测量入口与真实基线（P1）

依赖：任务 0。涉及工具、夹具与 performance-benchmark 单测。

1. 先写失败测试：缺 engine/依赖拒绝；输出目录冲突不覆盖；相同种子产生相同文件；两边场景互不污染；冷制作缓存/已有缓存/单改分别初始化；失败/超时不能汇总成成功；轮次与命令参数进入 JSON。
2. 执行 `node --test tests/unit/performance-benchmark.test.mjs`，确认失败源自缺失的目标能力，不是错误导入或环境配置。
3. 最小实现拟定命令。夹具生成真实可解析 PCM；探针同时理解旧整读和新分块读取，避免嵌套调用重复计数。统计逻辑读取量与完整内容哈希次数，不能用 readSync 系统调用数代替“同一文件哈希几遍”。
4. 再执行同一测试，检查退出码/失败数。测量时只启动自己管理的进程；测试超时和清理边界。
5. 从冻结副本执行 `node tools/bench-performance.mjs --engine <baseline>/plugin/engine --suite hash --rounds 5 --out <全新目录>`，再运行 workflow 组。参数中的占位路径必须在实际记录中展开。
6. 对两条管线执行首次/无改/单改和大音轨；运行器核对命令的成功、重渲镜数、输出规格及预览区间。将首次准备与制作时间分开。
7. 提交测量入口、契约测试及基线报告；报告包括原始数据和明确的命令。提交前运行相关测试、lint、diff 检查。

决策点：确认时间与内存分别主要消耗在哪里。继续 P2/P3 的依据是已证实的整读内存/重复字节，不据此承诺整个制作时间大幅下降。若需改 ffprobe 的同步接口或跨槽位复用，先更新规格，不能直接加入本任务。

## 任务 2：有界哈希原语（P2 底层）

依赖：任务 1 的基线已保存。涉及 file-hash 与其单测，暂不改业务调用者。

1. 写失败测试：0/1/块边界前后/非整块/256 MiB 文件；短读；文件 URL 与 Unicode 路径；已存在 Hash 的前缀+原始字节+后缀结果；读取中断/截断/替换/路径消失；描述符关闭。
2. 执行 `node --test tests/unit/file-hash.test.mjs` 并保留失败摘要。
3. 最小实现单缓冲区（≤1 MiB）顺序读取；用实际读取长度更新，处理短读/EOF，finally 关闭。大小前缀所需元信息与读内容来自同一次打开；前后核对变化。
4. 与独立旧算法对照摘要；通过读取/分配边界断言证明不申请整文件 Buffer，不用不稳定 RSS 数字替代该硬断言。RSS 在基准里另测。
5. 测试通过后单独提交。共享原语没有全局状态，不提供清理客户缓存的入口。

交付：保持原字节语义、有明确错误与资源边界的低层同步 API。

## 任务 3：接入四处哈希并保护校验（P2 业务接入）

依赖：任务 2。涉及 evidence/cache/timing/final-delivery 及现有测试。

1. 先补业务失败回归：大文件通过 fileDigest、hashParts、checkedVideo 和 deliverySnapshot 时仍整读；hashParts 的长度/顺序/缺失/空文件语义；deliverySnapshot 两遍之间内容变化必须拒绝。
2. 定向执行 `node --test tests/unit/file-hash.test.mjs tests/unit/shot-hash.test.mjs tests/unit/render-performance.test.mjs tests/unit/final-delivery.test.mjs`，确认新增资源约束在旧调用路径上失败，而既有正确性断言保持。
3. 最小替换哈希读取；hashParts 使用原始字节流，不将文件摘要当内容。保留最终交付双遍独立读取和 checkedVideo 检查后独立复读。
4. 如果原故障注入拦截 readFileSync，迁移到真正执行的新读取边界或两扫描之间的写入动作；同一故障仍应触发拒绝，不能删除断言或改成静态源码检查。
5. 再执行同一定向集合，以及 `node --test tests/integration/timing.test.mjs tests/integration/final-delivery.test.mjs`。检查帧数/容差、报告只读和签批绑定，单独提交。

交付：四处大文件读取的缓冲区有界，稳定输入的数据摘要兼容，业务保护仍在。

## 任务 4：sourceState 单次观察去重（P3）

依赖：任务 3。涉及 operations、evidence 可选读取器、source-state/operations 测试。

1. 先写 107 镜+音轨重复引用的失败回归：记录基线摘要，要求每个相同归一化路径完整哈希一次、音轨读取 N 而非 2N；数据中仍保留声明和树两种投影。
2. 补充相邻两次调用同长度内容改写并恢复 mtime、增删/改名、相同 basename 不同目录、缺失声明、audio/generated 排除、观察期间替换与阶段 await 后重读。默认 treeEvidence 不应继承该上下文。
3. 执行 `node --test tests/unit/source-state.test.mjs tests/unit/operations.test.mjs`，确认读取次数断言失败，再实现局部 map 与观察结束核验。
4. 对照旧算法证明稳定输入摘要相同；变化时失败或产生新摘要，不在完成账本里保存旧值。没有进程级/跨命令缓存。
5. 同一集合通过后执行 `node --test tests/integration/recovery-delivery.test.mjs tests/integration/flow-guard.test.mjs tests/integration/render-performance.test.mjs`，单独提交。

交付：重复内容读取减少，观察生命周期与原制作/流程保护不变。

## 任务 5：配对测量、回退判断与完整验收

依赖：任务 3/4 全部定向测试通过，候选代码冻结。

1. 用同一测量工具与输入对 baseline/candidate 串行交替测量，每场景至少 5 个有效样本；不同时运行其他测试渲染。先做无探针耗时，再做计数归因，保存全部失败与超时。
2. 按规格 3.4 核对硬指标与回退容差；差异落在噪声内时明确写“没有证实端到端提速”。出现超阈值回退先调查并复测，必要时只回退导致问题的独立提交，不降低校验强度。
3. 执行完整验证：

```bash
npm test
npm run test:jianying
npm run smoke
WKA_TIMING_LONG=1 node --test --test-concurrency=1 tests/integration/timing.test.mjs
npm run lint
npm run build:portable
git diff --check
```

4. 长片矩阵需实际覆盖 browser/Remotion、横/竖、高清/小样的 107 镜帧数与切点；它是正确性压力验证，不能用低分辨率测试的速度代替制作基准。依赖缺失时先修复验证环境，不把跳过计为通过。现有三平台 CI 追加 `node --test tests/unit/file-hash.test.mjs tests/unit/source-state.test.mjs`，验证新文件 I/O 行为；它们不得依赖 ffmpeg/浏览器，仍不把此项称为 Windows 渲染验收。
5. 对照 A1–A12 写最终报告：场景/输入、源码和工具版本、样本数、失败数、耗时/CPU/内存口径、读取量、重渲/解码/编码工作量、证据边界。
6. 文档与实现一致后提交；按后续授权提交 PR，并核对当前提交的 lint/smoke/严格 jianying/三平台安装 CI。合并与发布另按后续用户授权执行。

交付：可复核的收益/代价结论，全部验收映射和未验证边界，无“应该更快”的完成声明。

## 拆分、回退与当前状态

建议按测量工具 → 哈希原语 → 四处接入 → 状态去重 → 最终验收依次落地。代码各部分独立提交，先用同一基准判断收益，再决定是否进入下一项；不捆绑异步/并发或其他架构改造。无证据格式迁移，回退代码不需要删除旧依赖、素材、批准或输出。

初稿阶段完成源码核对、27 次隔离诊断和 32 项既有基线测试。两份文件现已获批，按任务 0→5 顺序实施；初稿检查不证明新工具或优化已实现。后续结果另记录于实施报告。

实施记录（持续更新）：

- `59d360b`：记录批准，冻结 v0.19.3 基线并创建独立 worktree。
- `a9c17da`：提交隔离测量工具与哈希基线。该提交的 8 项工具测试、lint、diff 检查通过；哈希组完成 45 次计时与 9 次探针。
- 完整制作基线运行中：两条管线的例片，以及 browser 的长片、大音轨和校验边界已完成。Remotion 107 镜首次预览约 4 分钟一轮；2026-10-31 用户获知夜间运行成本后明确选择“继续完整第三批，按已批准计划推进”。保持完整范围与 5 轮要求，不再重复确认。
- 测量期间准备低层哈希、四处接入、状态观察和工具边界的回归测试；这些新增用例尚待执行。生产实现未改，待完整基线保存后进入失败测试与实现步骤。

- 2026-10-31 02:39：完整基线完成，合计 285 次计时与 57 次探针、零失败。原始证据及工具源码已归档。测量工具新增边界用例先有 6 项预期失败，修正后 11 项全部通过；生产优化尚未开始。
