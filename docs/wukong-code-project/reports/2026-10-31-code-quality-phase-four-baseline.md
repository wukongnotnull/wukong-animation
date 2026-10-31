# 第四批实施基线

用户于 2026-10-31（Asia/Shanghai）明确批准规格和计划，要求从失败后的锁清理开始实施。审阅确认范围与验收一致，未发现阻碍实施的问题。

- 基线：v0.19.4 / `76c0d8a534decec724b72a141cb415ce5b6c506a`，已建立独立 detached worktree；原工作区开始时干净。
- 本地：macOS arm64、Node v25.8.1，ffmpeg 位于 `/opt/homebrew/bin/ffmpeg`。Node 20 与媒体版本将在最终验收分别记录，此处不代替兼容性验收。
- 独立临时 HOME/工程捕获 [CLI 基线夹具](../../../tests/fixtures/cli-v0.19.4.json)：22 条命令策略、23 组真实子进程输出/退出码、4 个模块公开导出集合。setup/check 的外部安装与探测不作为无依赖输出快照；后续用独立契约和环境集成验证。
- 基线定向测试：args、cli-unknown-command、load-film、qc-judge、delivery 共 **18/18 通过，零跳过**。
- 原始症状：空临时工程执行 `signoff <dir> "invalid-step probe" --step 999`，退出 1，stderr 为 `✗ --step 取 1–15`；operation.lock 和 active-command 均残留。新回归四项中 **3 通过、1 因锁残留失败**，不是环境/模块加载错误。

## 移动前的实现身份

| 来源 | 当前生产者/校验者 | 提取后的必要覆盖 |
| --- | --- | --- |
| job.loadFilm | 最终交付 encoding 显式包含 core/job.mjs；renderer 显式为 cache/word-sync/timing/fonts | film-context 应加入实际相关的 renderer/encoding 文件列表；保持投影分组 |
| qcConfig、QC 测量 | qc.runQc 和 final-delivery.qcState 各自计算 video/timing 摘要，algorithm 仅哈希 qc.mjs | 两端统一 qc-source，包含 qc、qc-config、qc-source 的稳定相对标识和文件摘要 |
| 命令编排、其余引擎代码 | operations.implementationState 与主版复核的全引擎身份 | 新 cli/core 模块仍在全引擎身份范围内；不能跨调用缓存 |
| 参数解析、交付输入 | 原 bin/args 和 delivery 导出 | 保持原入口与语义；仅替换依赖方向，不伪造旧证据兼容 |

新代码会正常改变实现身份；旧证据可能需要重新核实，历史文件与签批不迁移成通过。新版本内暖缓存复用另行验收。此记录只证明基线与红测，A1–A12 的最终结果另记验收报告。
