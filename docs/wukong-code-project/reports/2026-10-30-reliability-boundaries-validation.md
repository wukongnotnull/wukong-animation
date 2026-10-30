# 第一批可靠性修复验证

日期：2026-10-30（Asia/Shanghai）。跟踪：[Issue #113](https://github.com/wukongnotnull/wukong-animation/issues/113)。

依据：[已批准规格](../specs/2026-10-30-1923-reliability-boundaries-design.md)、[实施计划](../plans/2026-10-30-1928-reliability-boundaries.md)。代码验证对象：`ab8496e`，分支 `codex/reliability-boundaries-spec`。

## 实施结果

- R1：loadFilm 在 Schema 校验后拒绝重复镜头 ID，早于风格解析、镜头文件检查与渲染准备；主副版和 browser/Remotion 共用规则，不自动改写编号。
- R2：ShotCache 原子保存清单；空文件、截断 JSON 或无效清单结构报告路径及原因后按未命中恢复。读写访问错误继续报错。保存成功后才更新内存索引和淘汰旧片段，失败保留旧清单及旧命中。不清空整个缓存目录。
- R3：首次 Git 提交限定 `.gitignore`，不夹带用户已暂存的其他文件，保留无关索引条目的内容/模式和工作区修改。

实现分别提交为 `4f53782`、`ed90d37`、`ab8496e`。仅修改三个运行时文件；新增两份单元测试，扩展既有 Git 与真实渲染测试。共增加 18 项测试，没有放宽旧断言或跳过测试。

## 先失败、后通过的证据

| 修复 | 修改前的失败 | 修改后的定向结果 |
| --- | --- | --- |
| R1 | `node --test tests/unit/load-film.test.mjs`：2 通过、3 失败。两种风格均未拒绝重复 ID；render 先报镜头文件不存在，未检查重复编号。 | 与 `film-compat.test.mjs` 一起运行：11 通过、0 失败。 |
| R2 | `shot-cache.test.mjs`：3 通过、5 失败；坏 JSON 直接抛错，部分写入破坏原清单，替换失败注入未触发原子路径。真实短片测试完成首次渲染后，截断清单重跑退出 1，报 `Unexpected end of JSON input`。 | `node --test tests/unit/shot-cache.test.mjs tests/unit/ffmpeg-pipe.test.mjs tests/integration/render.test.mjs`：25 通过、0 失败、0 跳过。 |
| R3 | `project.test.mjs`：有效红测为 11 通过、1 失败。首次提交实际包含 `.gitignore` 和 `user-script.sh`。 | 同命令：12 通过、0 失败。 |

R3 最初另有一项测试准备失败：临时仓库中的文件同时存在暂存和未暂存差异，测试用 `git rm --cached` 清理被 Git 拒绝。仅在该临时测试目录用 `-f` 移除索引条目后重新跑红测，剩下的唯一失败才是产品缺陷；未将测试准备错误计为插件问题。

## 验收映射

| 规格 | 实际证据 |
| --- | --- |
| A1–A2 | 两种风格、两画幅、完全相同/不同文件与时长的重复项均拒绝；镜头文件缺失和 `requireShots:false` 也拒绝。render 入口拒绝后工程只保留原 film.json，未准备字体或缓存。合法配置保持镜头顺序、起点与副版覆盖文件选择。 |
| A3 | 覆盖空清单、截断 JSON、null、数组、缺少 shots、shots 数组、空条目、hash 类型错误；有路径与原因诊断，重建后正常命中，损坏条目引用的源文件未删。 |
| A4 | store/invalidate 分别注入“写了一部分后 ENOSPC”和“替换正式清单前失败”；旧清单字节、旧文件及内存/重开后的旧命中均保留，正常保存后重开可读。采用可控失败注入，未进行实际断电测试。 |
| A5 | 真实短片首次渲染后截断清单，同时破坏原片段，再用原 render 命令恢复。ffprobe 验证新片段 10fps/10帧；下一次重跑命中缓存。逐文件比对 film.json、镜头源码、原声音、混音、签批状态、approved 快照、另一画幅清单、参考素材、已审片文件和既有成片，全部字节不变。受保护媒体使用哨兵文件验证未写入，重新生成片段使用真实媒体验证。 |
| A6 | 有效缓存正常复用/替换/失效；读清单 EACCES 原样传播且不报降级成功，清单路径为目录报 EISDIR，保存 ENOSPC 不算成功。 |
| A7–A8 | 真实无 HEAD 仓库先暂存可执行模式的文件，再修改工作区；初始化后提交树仅有 .gitignore，无关 blob/mode、工作区字节和未暂存 diff 保持一致，文件仍待提交。空仓库、已有 HEAD、缺身份、pre-commit hook 拒绝提交均覆盖。 |

## 完整验证

本机 Node.js `v25.8.1`，macOS；沿用现有渲染与音视频依赖，没有安装新依赖。

- `npm test`：439 通过、0 失败、0 跳过、0 取消，约 189.3 秒。按仓库默认并发一次通过，未降并发重试。
- `CI=1 npm run smoke`：2 支示范片，水墨主版、Keynote 主版及竖版合计 9 张样张全部通过，平均差与变化像素均为 0；未更新基准。
- `npm run lint`：通过，包含结构/清单和生成文档一致性检查。
- `git diff --check 68d9d42..HEAD`：通过。
- 自查三个运行时文件的最终差异，未扩展到第二批安装/版本兼容/剪映 CI，也未改动第三批性能算法。

## 交付边界

三项本地实现与上述验收已完成。未推送、开 PR、运行远端 CI、合并或发布；已安装插件未更新。仅使用隔离测试工程和仓库示范片，没有写入客户作品或外部客户草稿。

本机完整通过不代替远端 CI；没有新增 Windows/Linux 实机结论。Issue 保持开放供 PR 与合并跟踪；仓库未指定 Project，不创建无关看板。推荐下一步提交 PR 并运行 CI，再按结果审阅合并。
