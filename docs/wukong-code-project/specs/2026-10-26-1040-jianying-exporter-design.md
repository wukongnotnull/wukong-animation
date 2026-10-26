# 剪映草稿导出器（jianying）设计

关联 issue：[wukongnotnull/wukong-animation#1](https://github.com/wukongnotnull/wukong-animation/issues/1)

## 1. 问题与目标

现有导出器（mp4 / gif / png-seq）只产出成片。用户需要在剪映里接着做后期（调节奏、换配乐、改字幕、重录人声），需要一个能在剪映专业版里直接打开、按镜头和音轨拆开的可编辑草稿。

目标：`wka final <片目录> --formats jianying`（或 film.json `export.formats` 含 `jianying`）在剪映默认草稿目录生成一份草稿，打开后有：

- 视频轨：每个镜头一段；
- 音频轨：人声一条，`build.mjs` 产出的每个文件各一条，`audio.tracks` 每项各一条；
- 字幕轨：每条 `voices` 一段。

已核实的事实（2026-10-26 实测）：pyJianYingDraft 0.3.1 写出的未加密草稿，复制一份为 `draft_info.json` 后，剪映专业版 11.6（macOS）能打开，视频 / 音频 / 字幕三轨都在；剪映打开后会把 `draft_info.json` 重新加密写回，`draft_content.json` 不被读取。

## 2. 架构与组件边界

```
cmdFinal
  ├─ mixSoundtrack → { mix, tracks, voices }        （改：额外返回未混音轨和人声时间）
  ├─ render        → { video, job, segments }       （改：额外返回每镜的分段文件）
  └─ encodeOutputs(…, timeline)                      （改：透传 timeline，导出器可返回实际产物路径）
        └─ exporters/jianying/index.mjs
              ├─ plan.mjs      buildDraftPlan(timeline) 纯函数：timeline → 草稿计划（微秒、线性音量）
              └─ write_draft.py  python3 + pyJianYingDraft：按计划建草稿、复制素材、保存
```

- 新文件：`plugin/engine/exporters/jianying/{exporter.json, index.mjs, plan.mjs, write_draft.py}`。
- 改动文件：`audio/soundtrack.mjs`、`core/job.mjs`、`bin/wka.mjs`、`exporters/_template/index.mjs`（注释）、`requirements.txt`、`docs/ARCHITECTURE.md`（导出器接口一行）。
- mp4 / gif / png-seq 导出器不改。

## 3. 接口、数据与行为

### 3.1 `mixSoundtrack` 返回值

由 `string|null` 改为：

```js
{
  mix: string|null,           // 原返回值：混好的 wav
  tracks: [{ role, file, start, gain }],  // role: 'voice' | 'build' | 'track'；file 为绝对路径
  voices: [{ text, at, duration, estimated }],  // 与 writeVoiceCues 用的时长一致；无音频时 estimated=true
}
```

`voice_source: none` 或没有 `voices` 时 `voices` 为空数组。调用方 `wka soundtrack` / `cmdFinal` 同步修改。

### 3.2 `render` 返回值

追加 `segments: [{ id, start, duration, file }]`，与 `ctx.shots` 顺序一致，`file` 为本次使用的分段文件。

### 3.3 `timeline` 与导出器签名

`cmdFinal` 组装后经 `encodeOutputs` 传给每个导出器：

```js
encodeOutput({ video, audio, out, fps, proxy, timeline })
timeline = { title, size: [W, H], fps, duration, shots: segments, tracks, voices }
```

`encodeOutput` 可返回实际产物路径；`encodeOutputs` 用 `返回值 || out` 记日志和返回。

### 3.4 草稿计划（`buildDraftPlan`，单元测试对象）

- 时间单位：微秒整数（`Math.round(秒 × 1e6)`）。
- 视频段：每镜一段，`start` 为前面各镜时长之和，名字为镜头 id。
- 音频轨：
  - `role: voice` 全部放在名为「人声」的一条轨；
  - `role: build` / `track` 每个文件一条轨，轨名取文件名；
  - 每段音量 = `10^(gain/20)`（gain 为 dB，缺省 0 → 1.0）；
  - 起点为 `start`，段长裁到片尾（`start` 超过片长的段丢弃）；实际素材时长由 Python 端再与素材长度取较小值。
- 字幕：每条 voice 一段，`start = at`，`duration = duration`，文字原样，默认样式；`estimated` 的条目在计划里保留标记供日志输出。
- 画布：`size`、`fps` 显式写入。

### 3.5 草稿写出（`write_draft.py`）

- 输入：计划 JSON 路径、草稿根目录、草稿名。
- `DraftFolder(root).create_draft(name, W, H, fps, allow_replace=False)`。
- 所有素材复制到 `<草稿>/materials/` 后再引用（草稿自包含）。
- 保存后把 `draft_content.json` 复制为 `draft_info.json`（两份都保留）。
- 任一步失败：删除本次新建的草稿文件夹（仅限本次创建的），非零退出并把错误打到 stderr。

### 3.6 输出位置与命名

- 草稿根目录：环境变量 `WKA_JIANYING_DRAFTS`，缺省 `~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/`。
- 草稿名：film.json `title`。
- 导出后日志提示：响度标准化与淡出需在剪映里处理；可能需要重启剪映才能看到新草稿；估算时长的字幕条目列表。

## 4. 约束、兼容性与非目标

- 仅支持并测试 macOS 剪映专业版 11.6；Windows 版、CapCut 不承诺。
- `exporter.json` 状态为 `experimental`，`ext` 为 `jianying`。
- `pyJianYingDraft==0.3.1` 锁定版本，作为可选依赖写入 `requirements.txt`；使用 PATH 上的 `python3`。
- 非目标：转场、关键帧、出镜小窗等动效映射；响度标准化与淡出；双语字幕、长句切分、字幕样式定制；覆盖已有草稿（不提供 `--force`）；`--install` 开关（默认即写入剪映目录）。

## 5. 错误处理与运维

| 情形 | 行为 |
| --- | --- |
| `--proxy` | 报错：草稿用于后期，需全分辨率导出 |
| 草稿根目录不存在 | 报错，提示在剪映「全局设置 → 草稿位置」查看路径并设置 `WKA_JIANYING_DRAFTS` |
| 已有同名草稿 | 报错，不覆盖，提示先在剪映里删除或改名 |
| `python3` 或 pyJianYingDraft 缺失 | 报错，给出 `pip install pyJianYingDraft==0.3.1` |
| Python 写出失败 | 清理本次新建的草稿文件夹，报错带 Python stderr |

`wka check` 增加一行可选项检测：`python3 + pyJianYingDraft`（用途：导出剪映草稿）。

## 6. 验收标准与测试

验收标准：

1. `wka final <片> --formats jianying` 在草稿根目录生成以片名命名的草稿，剪映 11.6 能打开。
2. 视频轨段数 = 镜头数，各段首尾相接，总长 = 片长。
3. 人声一条轨，段数 = 有音频的人声条数；`build` / `tracks` 每文件一条轨；音量与 gain 换算一致。
4. 字幕段数 = voices 条数，起点和时长与 cues 一致。
5. 素材全部位于草稿文件夹内。
6. 同名草稿、`--proxy`、根目录缺失、依赖缺失均按第 5 节报错，且不留下半成品草稿。
7. mp4 / gif / png-seq 导出行为不变，现有测试全部通过。

测试：

- 单元（`tests/unit/jianying-plan.test.mjs`，先写）：镜头首尾相接、人声同轨、gain→音量、片尾裁剪与丢弃、字幕时间与 estimated 标记。
- 集成（`tests/integration/jianying.test.mjs`）：`WKA_JIANYING_DRAFTS` 指向临时目录，真实 `wka final --formats jianying`，解析 `draft_info.json` 校验轨道 / 段数 / 时间 / 素材路径；同名草稿二次导出报错；缺 browser 管线依赖或 pyJianYingDraft 时跳过。
- 回归：`node --test tests/unit/*.test.mjs tests/integration/*.test.mjs`、`node tests/smoke/run.mjs`。
- 人工：样片导出后由用户在剪映 11.6 打开验收。
