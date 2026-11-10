# 签批前提交并进入下一工序实施计划

目标：让签批只决定是否进入下一道有效工序，并且放行的就是工作台打开的那一次提交。

架构：影片仓库保存精确范围的待审提交和随后的结论提交。工作台核对提交、文件校验值和审阅状态，不启动制作。制作会话读取已生效结论后执行下一工序。技术栈为现有 Node.js 20、`node:test` 和本机 Git，不新增依赖。

全局约束：不恢复任何费用确认，不让工作台启动制作，不重审历史已通过工序，不把无关改动自动塞入提交。旧影片继续只读。现有忽略规则保持媒体文件不入库，但新增的校验清单必须可提交。提交失败、校验不一致、存在范围外改动、检查未完成或阻塞意见未处理时，不写通过结论、不推进 `.wka/state.json`。

对应规格：`docs/wukong-code-project/specs/2026-11-10-2101-signoff-commit-gate-design.md`。跟踪 issue：[#137](https://github.com/wukongnotnull/wukong-animation/issues/137)。

## 文件

- `plugin/engine/core/project.mjs`：新增按路径提交，停止签批时整目录暂存。
- `plugin/engine/core/delivery-manifest.mjs`：生成并核对 `delivery-manifest.json`。
- `plugin/engine/core/state.mjs`：记录通过或返修；通过才推进到下一道有效工序。
- `plugin/engine/cli/commands/review.mjs`：先完成待审提交，成功后才写签批。
- `plugin/engine/cli/workbench-server.mjs`：去掉签批后的整目录补充提交。
- `plugin/engine/core/workbench.mjs`：报告提交标识、一致性，并阻止不合格决定。
- `plugin/engine/workbench/model.mjs`：提供按钮文案和提交状态。
- `plugin/engine/workbench/app.js`：显示短标识，按钮改为“通过并进入下一步”。
- `plugin/skills/director/SKILL.md`：删除费用确认，改签批问题和返修规则。
- `tests/unit/review-commit.test.mjs`、`tests/unit/delivery-manifest.test.mjs`、`tests/unit/signoff-gate.test.mjs`：分别覆盖提交、校验和签批。
- `tests/unit/workbench.test.mjs`、`tests/unit/director-signoff-copy.test.mjs`：覆盖工作台门槛和导演文案。

## 任务

### 1. 精确提交

依赖：无。产出：`commitPaths(filmDir, { message, paths })`，返回 `{ sha, created }`。

1. 写 `tests/unit/review-commit.test.mjs`。临时仓库只设置本仓库身份。测试要求只提交指定文件、范围外改动时拒绝、内容已一致时不产生空提交。
2. 运行 `node --test tests/unit/review-commit.test.mjs`，预期因函数不存在失败。
3. 在 `project.mjs` 实现 `commitPaths`。只暂存传入路径，提交命令也只带这些路径；不调用 `git add -A`。
4. 重跑同一命令，预期通过。
5. 提交本任务的实现和测试。

### 2. 校验清单

依赖：任务 1。产出：`buildManifest(dir, step)`、`writeManifest(dir, manifest)`、`verifyManifest(dir)`。

1. 写 `tests/unit/delivery-manifest.test.mjs`。文本工序包含 `brief.md`、`story.md`、`storyboard.md`、`film.json` 和镜头、声音脚本。小样、成片、检查结果只记录路径、字节数和 SHA-256，文件本身不被列为可暂存。改动一个字节后校验失败。
2. 运行 `node --test tests/unit/delivery-manifest.test.mjs`，预期失败。
3. 新增 `delivery-manifest.mjs`，把清单写到片目录根的 `delivery-manifest.json`。复用现有文件摘要，不改忽略规则。
4. 重跑同一命令，预期通过。
5. 提交本任务。

### 3. 签批顺序

依赖：任务 1 和 2。产出：待审提交成功前不改变 `.wka/state.json`；通过后进入下一道有效工序；返修另记结论且不推进。

1. 写 `tests/unit/signoff-gate.test.mjs`。覆盖范围外改动、Git 失败、校验不一致、空提交、已排除的第 7/8 道，以及同一提交上先通过和先返修两种顺序。
2. 运行 `node --test tests/unit/signoff-gate.test.mjs`，预期失败。
3. 调整 `review.mjs` 和 `state.mjs`：先写清单并 `commitPaths`；已一致时使用当前提交。成功后，通过才推进工序，返修只追加结论。`next` 跳过方案已排除的工序，最后一道的下一状态为完成。删除 `workbench-server.mjs` 中签批后的 `commitSnapshot`。
4. 重跑同一命令，预期通过。原签批测试因顺序变化失败时，只更新直接受影响的断言。
5. 提交本任务。

### 4. 工作台门槛

依赖：任务 3。产出：报告含 `reviewCommit` 和提交状态；不合格时 `decideWorkbenchStage` 拒绝。

1. 在 `tests/unit/workbench.test.mjs` 增加未提交、文件变化、未检查、阻塞意见、相反结论和历史已通过工序六组断言。
2. 运行 `node --test tests/unit/workbench.test.mjs`，预期新增断言失败，旧断言保持通过。
3. `captureWorkbench` 读取待审提交并调用 `verifyManifest`。只有清单一致、检查完成且没有阻塞时允许通过。先保存的结论使后到的相反决定失败。没有清单的旧通过记录保持原结论。
4. 重跑同一命令，预期全部通过。
5. 提交本任务。

### 5. 界面与导演流程

依赖：任务 4。产出：界面显示短标识和“通过并进入下一步”；导演流程不再询问费用。

1. 在 `model.mjs` 增加状态文案函数，并写 `tests/unit/director-signoff-copy.test.mjs` 断言技能文本包含“进入下一工序”和“完成制作吗？”，且不再包含“预计费用”。
2. 运行 `node --test tests/unit/director-signoff-copy.test.mjs tests/unit/workbench.test.mjs`，预期文案测试失败。
3. 修改 `app.js` 和 `plugin/skills/director/SKILL.md`。卡片选项为“进入”和“要返修”；返修必须记录意见。删除模型、数量、时长、费用和预算确认。
4. 重跑上一命令，预期通过。
5. 提交本任务。

### 6. 整体验收

依赖：任务 1 至 5。

1. 运行 `npm test`，预期全部通过。
2. 运行 `npm run lint`，预期通过。
3. 启动现有影片工作台，打开《AGI科普讲解》的剧本页，确认已通过的方案简报未被退回，当前剧本旁能看到提交状态。
4. 核对分支、worktree 和未跟踪文件。只提交本计划范围内的文件，保留原有 `outputs/`、`tmp/` 和仍在使用的影片仓库。
