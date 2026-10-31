# 第五批实施与验收记录

状态：第五批实现、main 保护激活及服务器拒绝验证均完成；用户已授权发布 v0.19.6。下文保留实施时点的记录，最终激活证据见文末。

基线：v0.19.5 / `9b913f2e4bc37835406f6366efb4c06305ff8268`。规格和计划已获用户明确批准。实现见 [PR #122](https://github.com/wukongnotnull/wukong-animation/pull/122)，跟踪 [#113](https://github.com/wukongnotnull/wukong-animation/issues/113)。

## 合并检查

新增始终响应 PR 的 merge-gate，调用可复用的 lint、三平台安装、严格剪映及媒体回归工作流。必要任务不是 success，或者分类任务失败，汇总均拒绝通过。纯文档仅允许 README.md、LICENSE/其 md/txt 文件、docs 下的 md/txt；未知路径、混合变更和代码重命名都执行完整检查。保留既有 push/手动入口，移除子工作流的独立 PR 触发，避免 PR 内重复编排。

- [代码/混合变更实际通过](https://github.com/wukongnotnull/wukong-animation/actions/runs/41167617247)。
- [纯文档 PR #123](https://github.com/wukongnotnull/wukong-animation/pull/123)：[运行结果](https://github.com/wukongnotnull/wukong-animation/actions/runs/41167627598)中媒体明确 skipped，lint、三平台、严格剪映及 merge-gate 成功。
- [故障 PR #124](https://github.com/wukongnotnull/wukong-animation/pull/124)：故意制造版本清单冲突，[lint 与 merge-gate 失败](https://github.com/wukongnotnull/wukong-animation/actions/runs/41167663342)；恢复原清单后，[全部检查与汇总重新成功](https://github.com/wukongnotnull/wukong-animation/actions/runs/41168277429)。
- 两个临时 PR 均已关闭，未合并故障或测试夹具。

检查来源已实际读回为 GitHub Actions App **15368**，稳定上下文名 **merge-gate**；账号具有 admin 权限。目标保护配置见 [main-protection.json](../../../tools/main-protection.json)，管理员受约束，要求 PR、最新基线和必过结果，禁止强推/删除，审批人数为零。

**激活前置条件：** 当前 main 尚不包含新工作流。此时启用必过上下文，会让从旧 main 创建的其他 PR 等待不存在的检查。因此先完成可审阅实现，按计划的后续合并授权将定义放入 main，再激活保护、读回并以最新 main 的失败 PR 验证服务器拒绝。现阶段未调用合并故障 PR 的 API，也未变更 main 保护。

激活时先再次保存 `branches/main/protection` 与 rulesets 并核对无并发变更；使用 branch protection PUT API 应用目标 JSON。原本无保护时，回退为删除本次保护；若激活前出现其他保护，必须保留并恢复其原字段。具体操作边界见[贡献指南](../../CONTRIBUTING.md)。

## 升级诊断

新增显式 `check --upgrade` 和 `check --upgrade --json`。输出插件/引擎版本、实际路径、已识别的包格式、依赖目录/来源/身份，以及按渠道给出的操作指引。默认 check 保持原行为。

- 原生包比较清单名称和版本；便携包验证清单、路径与文件摘要；开发副本和未知来源明确标识。原生包格式不能证明宿主当前加载状态，指引使用条件表述。
- 全程离线只读；远端最新版本和宿主重载状态为未知，不能据此声称已是最新版。
- 只识别宿主配置中所需的基础 marketplace 字段；未知语法给安全警告，不输出原始行或凭据。失效的其他本地条目不阻断本插件诊断，不自动删除配置或调用更新/setup。
- 清单错误、身份冲突、缺必要依赖退出 1；未知远端/宿主状态仅警告。JSON 具备 schemaVersion:1，错误类型的版本值转为 null。
- setup 技能增加自然语言入口；生成的安装指南明确 v0.19.5 正式包不含这个新增功能。当前同版本便携构建仅为验收产物，不能当作正式更新分发。

## 失败到通过

门禁缺少模块、代码重命名被误判文档、LICENSE.mjs 被白名单误收，均先有有效失败再修正。诊断缺能力、失效条目无提示、非法版本值被回显、未识别配置语法无警告及人类输出缺依赖身份，也有针对性失败测试。

Windows 首轮在测试夹具使用 URL.pathname 时产生 `D:\\D:` 路径，日志定位后改为 fileURLToPath；未放宽断言。[修正后的三平台及完整 PR 检查已通过](https://github.com/wukongnotnull/wukong-animation/actions/runs/41168448678)。此链接为阶段提交；最终验收须再核对 PR #122 当前头提交，不能以旧提交成功替代。

## 本地验证及边界

- 完整回归：575/575，零失败、零跳过；该轮核心代码为 `442617a5a9a23fcd32c217b25e4e420298aaad6c`。此后仅补齐人类诊断输出的依赖来源/身份及说明文字；最终代码另执行 Node 20 的 51 项命令、架构和诊断检查，并由当前 PR CI 再跑完整回归。
- 严格剪映：19/19，零跳过。视觉样张：9 张零像素差。
- 默认 check 与隔离 v0.19.5 基线实际对照：仅归一化插件真实路径，退出码、stdout、stderr 一致。
- 实机只读诊断前后，宿主配置摘要保持；原生与便携副本在仓库外正常输出 JSON，ZIP CRC 与 231 个清单文件摘要通过。
- 新增诊断使用 PATH 为空的隔离进程验证，结果可解析、退出码对应，临时用户目录无写入。
- lint、架构 77 模块零循环、便携构建和 diff 检查通过。引擎运行时依赖、工程流程和证据 schema 未改。

## A1–A8

| 条目 | 状态 |
| --- | --- |
| A1 稳定上下文/保守分类 | 实际代码和文档 PR、16 项策略测试通过 |
| A2 失败不能放行 | 真实故障与恢复通过，失败/取消/缺失/跳过的策略用例通过 |
| A3 main 保护及服务器拒绝合并 | **待合并定义后激活和验证，尚未完成** |
| A4 原入口及三平台/严格剪映 | 阶段提交实际通过；最终提交以当前 PR CI 为准 |
| A5 身份/冲突/损坏/缺依赖 | 定向回归及原生/便携实跑通过 |
| A6 配置保留与只读 | 故障配置、凭据不回显、真实配置摘要及空 PATH 回归通过 |
| A7 JSON/退出码/警告 | 定向回归通过 |
| A8 兼容及全回归 | 本地结果如上，最终当前提交 CI 结果记录在 PR #122 |

原始阶段日志与配置快照见[证据归档](assets/ci-protection-upgrade-diagnostics/local-evidence.tar.gz)，包含失败诊断而不隐藏中途问题；不包含完整宿主配置、凭据、媒体或依赖缓存。合并、保护激活及正式补丁发布结果分别记录在 PR 与 #113 中。

归档文件数：36；SHA256：`72988bbcc68782901001a3964f76027b3c5f88b1b800cdd236bc56e9658d6172`。


## main 保护实际激活与服务器验收

PR #122 合并为 `850124cec8f97fee003773790b2d79f4c4a25c90` 后应用并读回保护：要求 PR、最新基线、merge-gate（App 15368）成功，管理员受约束，禁止强推/删除，审批人数为零。

[临时 PR #125](https://github.com/wukongnotnull/wukong-animation/pull/125) 基于最新 main，非草稿、behind_by=0；[生成文档漂移使门禁失败](https://github.com/wukongnotnull/wukong-animation/actions/runs/41170318527)后，管理员使用准确 head SHA 调用合并 API，实际得到 HTTP 405：`Required status check "merge-gate" is failing.`。PR 未合并，main SHA 保持。

[恢复文档后全部必过检查成功](https://github.com/wukongnotnull/wukong-animation/actions/runs/41170564088)，服务器状态 CLEAN、MERGEABLE；随后关闭临时 PR，不合入测试内容。A3 至此完成；前文待激活标记为历史时点。原配置、应用和读回及实际拒绝响应已保存，并在 #113 和 PR #122 留存结果。

本次 v0.19.6 发布只同步版本与说明，不改变已验收的引擎代码或保护设置；发布提交的 CI、正式包和安装升级另按发布流程验证。
