# 剪映导出：避开同名草稿、剪映开着时先拦住

关联 issue：[wukongnotnull/wukong-animation#24](https://github.com/wukongnotnull/wukong-animation/issues/24) 第 2、3 条

## 1. 问题与目标

《一叶知秋》试拍里，剪映草稿导出卡了两次：

1. **同名草稿已存在就中止**。成片返修后重导时，导出器报「剪映草稿已存在」并退出。用户要求新稿件区别命名，导演只好手工改目录名、改 `draft_meta_info.json`。
2. **剪映开着时导出，草稿会被写回旧版**。剪映运行中会把内存里的旧版本写回草稿目录，导出的新内容就被覆盖。当时只能请用户手动 ⌘Q 再重导。

目标：

- 同名草稿已存在时，自动导出为 `<片名>_v2`、`<片名>_v3`……旧草稿一字不动，日志说明新名字。
- 剪映正在运行时，导出前就报错，请用户先完全退出剪映，什么都不写。

已核实的事实：

- `exporters/jianying/index.mjs` 用 `plan.name`（即 `film.json` 的 `title`）拼出草稿目录 `<草稿根目录>/<片名>`，目录存在就抛错。`write_draft.py` 用 `plan["name"]` 调 `create_draft(..., allow_replace=False)`，并在 `fresh_ids` 里把 `draft_name`、`draft_fold_path` 写进 `draft_meta_info.json`。所以只要把改好的名字放进 plan，Python 那边不用改。
- 本机剪映专业版安装在 `/Applications/VideoFusion-macOS.app`，可执行文件和进程名都是 `VideoFusion-macOS`。导出器说明写的是「实测 macOS 剪映 11.6」，Windows 没有实测过。
- 导演规则（`director/SKILL.md` 第 14 道和返修表）、流程文档（`docs/PRODUCTION-WORKFLOW.md` 第 14 道和返修表）现在都写着「重导前要先在剪映里删掉或改名旧草稿」，`tests/integration/jianying.test.mjs` 有一个测试断言「同名草稿已存在时拒绝导出」。

## 2. 架构与组件边界

```
wka final --formats jianying
  └─ exporters/jianying/index.mjs encodeOutput
       1. jianyingRunning()   剪映在运行 → 报错，什么都不写
       2. draftsRoot()        草稿根目录不存在 → 报错（不变）
       3. freeDraftName()     片名被占用 → 片名_v2、_v3……
       4. write_draft.py      按新名字写草稿（不改）
```

- 改动文件：`plugin/engine/exporters/jianying/index.mjs`；新建 `plugin/engine/exporters/jianying/guards.mjs` 放两个纯函数 / 小函数，方便单测。
- 文档：`plugin/skills/director/SKILL.md`、`docs/PRODUCTION-WORKFLOW.md`（升 v1.5.1）、`README.md`（如果提到同名中止）。
- 不改：`write_draft.py`、`plan.mjs`、剪映草稿的内容和分轨。

## 3. 接口、数据与行为

### 3.1 同名草稿自动改名

`freeDraftName(root, name)` → 字符串：

- `<root>/<name>` 不存在 → 返回 `name`。
- 存在 → 依次试 `<name>_v2`、`<name>_v3`……返回第一个不存在的。
- 试到 `_v99` 都被占用 → 抛错「剪映草稿目录里已经有 99 份《<name>》（原名加 _v2 到 _v99），请先在剪映里清理旧草稿」。
- 只看目录是否存在，不看里面的内容；旧草稿目录一个文件都不碰。
- 名字里的版本号只在导出时决定，不写回 `film.json`。

导出器拿到新名字后：

- `plan.name` 换成新名字，再交给 `write_draft.py`，草稿目录名和剪映里显示的草稿名一致。
- 改了名时日志加一行：`· 剪映里已有草稿「春晓」，这次导出为「春晓_v2」，旧草稿没动`。
- 导出结果路径（`wka final` 末尾打印的绝对路径）是新目录。

### 3.2 剪映开着时先拦住

`jianyingRunning()` → 布尔：

- macOS：`pgrep -x VideoFusion-macOS` 退出码为 0 视为正在运行。
- 其他系统：返回 `false`，不拦（没实测过，进程名也不确定）。
- 进程名可用环境变量 `WKA_JIANYING_PROCESS` 覆盖（剪映改了进程名时临时用，也供测试用）。

导出器的第一步（在 `--proxy` 检查之后、读草稿根目录之前）：剪映在运行就抛错，什么都不写：

```
剪映正在运行。剪映退出时会把内存里的旧草稿写回草稿目录，覆盖这次导出的内容。
  请先完全退出剪映（⌘Q），再重新运行 wka final <片目录> --formats jianying
```

`wka final` 在调导出器之前已经渲染、拼接完成（镜头读缓存），拦住后重跑很快。

### 3.3 文档

| 位置 | 改成 |
|---|---|
| SKILL 第 14 道「用户选导出」 | 导出前先请用户完全退出剪映（⌘Q），引擎检测到剪映在运行会拒绝导出；剪映里已有同名草稿时引擎自动导出为 `<片名>_v2`……旧草稿不动，交付时把日志里的新草稿路径告诉用户 |
| SKILL 第 14 道「告诉用户」 | 去掉「重导前要先在剪映里删掉或改名旧草稿」，改为：重导会生成新的一份（`_v2`、`_v3`……），旧草稿和你在里面的改动都还在，不要的可以在剪映里删掉 |
| SKILL 返修表「草稿返修」 | 去掉「请用户在剪映里删掉或改名旧草稿」，改为「请用户退出剪映 → 重导（自动起新名字）→ 重新提交 ⑩」 |
| 流程文档第 14 道总表、正文第 2 步、注意事项、返修表 | 同上；修订记录加 v1.5.1 |

## 4. 不做什么

- 不检测 Windows 上的剪映进程。
- 不自动退出剪映，也不等剪映退出。
- 不删除、不合并旧草稿；不把剪映里的改动带进新草稿。
- 不改草稿内容、分轨和字幕样式。
- 不在 `wka check` 里加剪映进程检查（导出时才需要）。

## 5. 测试计划（先写失败的测试）

| 测试 | 位置 |
|---|---|
| `freeDraftName`：目录不存在 → 原名；`春晓` 已存在 → `春晓_v2`；`春晓`、`春晓_v2` 已存在 → `春晓_v3`；`春晓_v3` 存在但 `春晓_v2` 不存在 → `春晓_v2`；v2–v99 全部占满 → 报错 | `tests/unit/jianying-guards.test.mjs`（新建） |
| `jianyingRunning`：`WKA_JIANYING_PROCESS` 设成一个一定在运行的进程名（当前 node 进程的名字）→ `true`；设成不存在的名字 → `false` | 同上 |
| 原「refuses to overwrite an existing draft」改为：同名草稿存在时导出成功，生成 `jy-it_v2`，`draft_meta_info.json` 的 `draft_name` 为 `jy-it_v2`，旧目录里只有 `keep.txt`，日志有「这次导出为「jy-it_v2」」 | `tests/integration/jianying.test.mjs` |
| 剪映在运行（`WKA_JIANYING_PROCESS` 设成在运行的进程名）→ 导出失败，报「剪映正在运行」，草稿根目录里什么都没多 | 同上 |
| 其余集成测试设 `WKA_JIANYING_PROCESS` 为不存在的名字，避免本机开着剪映时测试失败 | 同上 |

## 6. 验收标准

- A1 剪映里已有《春晓》时，`wka final films/chunxiao --formats jianying` 生成「春晓_v2」，剪映里能看到两份草稿，旧的内容不变。
- A2 剪映开着时运行同一命令，报「剪映正在运行」并退出，草稿目录没有变化；退出剪映后重跑成功。
- A3 SKILL.md、PRODUCTION-WORKFLOW.md 不再要求用户手动删除或改名旧草稿，流程文档升 v1.5.1。
- A4 全部测试、smoke、lint、build-docs 检查通过。
