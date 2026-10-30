# 第二批可靠性优化验收记录

状态：实现、本地验收与远端 CI 验收完成；PR #116 待审阅合并。

关联：[已批准规格](../specs/2026-10-30-2045-reliability-phase-two-design.md)、[实施计划](../plans/2026-10-30-2048-reliability-phase-two.md)、[#113](https://github.com/wukongnotnull/wukong-animation/issues/113)、[PR #116](https://github.com/wukongnotnull/wukong-animation/pull/116)。用户批准后，按依赖锁定 → 流程保护 → 剪映必跑 CI 的顺序实施。

基线为 v0.19.2 / `abfd4f0319263f84f8f690cc30bf8a6820817a2e`。最终运行时与测试提交为 `c9cf0a88bfa84cddb1af65f86453a6f21a54f6d6`；后续仅补充本报告和规格/计划状态，不改变被验证的代码。未合并、未发布，也未升级已安装插件。

## 本地最终结果

macOS arm64，Node 25.8.1，Python 3.13.3，pyJianYingDraft 0.3.1。在固定上述提交、停止编辑运行时代码后执行：

| 命令 | 结果 |
| --- | --- |
| `npm test` | 484 通过，失败/跳过/取消/待办均为 0，232.5 秒 |
| `npm run test:jianying` | 指定三文件 13 + 2 + 4 = 19 通过，失败/跳过/取消/待办均为 0 |
| `npm run smoke` | 9 张样张通过，与既有 macOS 基准平均差、变化像素均为 0；未更新基准图 |
| `npm run lint` | 结构、清单、工具包文档、便携文档检查通过 |
| `npm run build:portable` | 213 个清单文件，ZIP 构建成功，来源提交为上述 SHA |
| `git diff --check` | 通过 |

额外使用 Node 20.20.2 执行严格运行器单测：13 通过，零跳过。开发安装实际执行 `npm run setup` 后，`wka check` 成功；直接依赖清单、锁文件及视觉基准相对基线没有变化。

## 验收映射

| 验收 | 实现和证据 |
| --- | --- |
| A1 | 复制完整 package.json/package-lock.json 字节，使用 npm ci。缺失、损坏、清单不一致的锁明确失败；CLI 故障注入确认没有 npm install 回退。原生副本和便携包都实际完成安装。 |
| A2 | 身份包括引擎版本、两个文件摘要、平台、架构、Node 主版本。同身份复用；改变任一身份输入则隔离。旧共享目录和其他身份保留。 |
| A3 | 临时目录安装、浏览器检查、凭据完成后才发布。npm 失败、Chromium 失败、无效目标、同身份互斥、崩溃锁恢复与恢复竞争均有回归；仅缺浏览器时不重装 npm 包。 |
| A4 | requireDep/resolveDep 共用经过验证的根；父级包、全局包、包加载异常及越界符号链接不触发跨根回退。合法开发安装可用，已存在但无效的托管目录不能被开发目录掩盖。 |
| A5 | 原生副本、便携安装、仓库开发安装均实跑。原生 217 个文件、便携安装 215 个文件在 setup/check/再次 setup 前后逐文件摘要不变；包版本一致。依赖身份按进程惰性验证，没有逐帧扫描包树。 |
| A6 | 缺 state、缺 flow、flow 1–5 继续原语义；6/99、null/0/负数/字符串/小数/布尔值/对象/数组、损坏 JSON 均拒绝或明确报错。未来状态输入对象与文件原字节保留，I/O 错误不当作新片。 |
| A7 | 混合项目继续显示兼容影片；未来影片不解释工序/签批。resume 普通及 JSON 输出均给出只读诊断与升级指引，退出 1，不提供重跑制作建议。 |
| A8 | 18 类 CLI 调用在无产物和已有产物两种工程中验证，涵盖仅有 brief 的占位片和完整 film、force、三种 delivery、brief/init/init-project。检查全部路径、模式与字节，真实 Git HEAD/index，以及外部草稿哨兵；子进程诱饵确认没有启动制作或 Git 操作。 |
| A9 | 状态写入、loadFilm、阶段执行、制作锁、恢复读取、报告、最终交付登记、Git 初始化和快照入口复用同一检查。现有批准幂等、主副版、旧迁移、恢复与最终交付回归通过。 |
| A10 | Linux Node 20/Python 3.11 实际执行剪映导出、最终交付、字体映射三个文件，19 项全部执行；覆盖 107 镜主副版切点、真实视频/SRT/草稿、签批绑定与用户手改保护。 |
| A11 | 13 项运行器用例覆盖真实通过、失败、skip、todo、取消、空文件、空 suite、导入错误、子进程 exit 7、缺文件、单文件空执行及依赖预检故障。日志管道使用 bash pipefail；同式故障注入 exit 7 经 tee 后仍退出 7。 |
| A12 | push、PR 和 workflow_dispatch 均出现 jianying 检查；逐条核对日志中的真实计数和 shell，不仅查看绿色状态。缓存命中、未命中证据见下节。没有修改分支保护。 |

依赖与安装定向测试 21 项；状态、写入保护、工程 Git、阶段和最终交付定向组合 61 项；这些数字是相应开发阶段的命令结果，最终完整集合以上表 484 项为准。

## 真实安装记录

两种分发格式分别使用独立临时用户目录，执行真实 `setup`、`check`、再次 `setup`。便携包经 ZIP 解压与 `install-agent.mjs --agent cursor --scope project` 安装后验证；未操作当前已安装插件或客户作品。

身份：`51e35f416e1df2fdb03f06aaecbacab4c9991f2beb1537dcd076192c98b6c233`（macOS arm64 / Node 25 / 引擎包 0.2.0）。两份实际安装的直接包版本均为：Playwright 1.64.1，Remotion、@remotion/bundler、@remotion/renderer 4.0.539，React、React DOM 19.3.1。

该实跑使用真实 npm ci 和固定 Playwright CLI。Chromium 可复用已存在的系统用户浏览器缓存，不能将此记录描述为重新下载了浏览器。安装故障、目录保留和并发行为另外由故障注入证明。

## 远端证据

以下均针对最终运行时代码 `c9cf0a8`；具体日志可在 run 的 job 中查看。

| 触发/检查 | 结果和链接 |
| --- | --- |
| push / jianying | [41068758980](https://github.com/wukongnotnull/wukong-animation/actions/runs/41068758980)：19 通过，零失败/跳过/取消/待办；测试步骤约 76 秒 |
| PR / jianying | [41068767600](https://github.com/wukongnotnull/wukong-animation/actions/runs/41068767600)：19 通过，零失败/跳过/取消/待办；测试步骤约 71 秒 |
| workflow_dispatch / jianying | [41069206336](https://github.com/wukongnotnull/wukong-animation/actions/runs/41069206336)：19 通过，零失败/跳过/取消/待办 |
| workflow_dispatch / pip 缓存未命中 | [41070450097](https://github.com/wukongnotnull/wukong-animation/actions/runs/41070450097)：日志明确 pip cache is not found；实际安装后 19 通过，零失败/跳过/取消/待办 |
| PR / 完整回归及视觉冒烟 | [41068767665](https://github.com/wukongnotnull/wukong-animation/actions/runs/41068767665)：484 项中 469 通过、15 项因可选 Python 依赖未安装而跳过；独立剪映任务已执行这些用例。9 张 Linux 样张均零差异 |
| PR / 三平台分发 | [41068767539](https://github.com/wukongnotnull/wukong-animation/actions/runs/41068767539)：Ubuntu、macOS、Windows 的便携生命周期及 ZIP 运输检查通过 |
| PR / lint | [41068767507](https://github.com/wukongnotnull/wukong-animation/actions/runs/41068767507)：通过 |

缓存命中运行确认 npm、pip、Chromium 下载缓存命中，仍实际执行安装与启动预检。为复核缓存未命中，仅移除本审阅分支创建的 pip 下载缓存，再次手动触发并通过；npm 和 Chromium 下载缓存在该次仍命中，不将其描述为全部缓存清空。未移除其他分支或主分支缓存。

## 失败到通过及审阅修正

- 依赖身份/解析最初 9 项失败；安装单测最初 7 项失败。三项 CLI 安装回归对归档的旧提交实跑全部失败，明确暴露 npm install、缺锁不拒绝及旧共享根写入。随后定向测试通过；补充全 node_modules 越界链接和锁恢复竞争后，两个新增用例先失败再修复。
- 流程回归最初复现较新 flow 被重写、非法版本被接受；写入回归捕获拒绝前新增 `.cache/active-command.json` 和待签批文件。修复后逐字节和 Git 断言通过。
- 严格运行器最初 12 项因缺少入口失败；实现后修正 macOS `/var` 与 `/private/var` 的真实路径归属，再以 Node 20 和 Node 25 验证。追加 exit 7 场景后共 13 项。
- 首次新 workflow 因 job 级环境不支持 `runner.temp` 而无 job，改为测试 step 环境后能执行。
- 首次执行虽然 GitHub 显示成功，实际日志为 17/19：默认 shell 未开 pipefail，tee 吞掉失败。该结果作废，不作为通过证据。显式 bash + pipefail 后保留失败退出码，并核对后续真实 19/19 计数。
- Linux 首次真正执行暴露两处跨平台测试条件：180×320 长句夹具在备用字体下达到 8px 下限仍溢出，改成同画幅 360×640，保留长句警告、字号拟合、原生测量、文本错配与空译文全部断言；既有 WKA_JIANYING_PROCESS 覆盖原先仅在 macOS 生效，扩展为 Linux 显式指定时使用真实 pgrep，默认 Linux 仍不猜测剪映进程。没有伪造进程检测、跳过用例或修改字幕算法。
- 完整测试中旧清理夹具把 state.json 写成普通文本 `keep`，与本批拒绝损坏状态的要求冲突。夹具改成合法 flow 5，并仍逐字节检查进度、批准身份、声音和定稿文件不被清理。最终冻结提交上的 484 项全部通过。

开发阶段原始日志保存在本机 `/tmp/wka-phase2-*`；这些临时日志不是永久交付附件。以上摘要和 GitHub run 链接保留可审阅证据。中途仍在编辑代码时运行的测试结果不作最终验收依据。

## 边界与后续

- 本批不发布版本；构建出的 0.19.2 ZIP 仅用于验证，不能当作同版本更新重新分发。合并、补丁发布和已安装插件升级需按后续授权进行。
- Windows CI 验证便携安装/升级/路径别名/ZIP 运输，不等于 Windows 真机渲染或剪映桌面验收。真实 npm 安装的两种格式在 macOS 验证，Linux 由仓库安装及真实导出 CI 验证。
- Linux 自动化不代替 macOS 剪映 11.6 桌面打开、字幕观感或其他宿主 UI 验收；本轮未重新执行这些人工检查。
- 新依赖身份需要一次 setup，旧目录保留；不自动垃圾回收。不支持的工程流程没有 force 绕过、降级或修复。
- #113 先前已随第一批关闭；第二批继续在其评论中跟踪。仓库未配置 Project，未新增看板。

推荐下一步：按 PR #116 的最终差异和本报告审阅，确认全部最新 CI 成功后合并；再单独授权补丁发布与安装升级。
