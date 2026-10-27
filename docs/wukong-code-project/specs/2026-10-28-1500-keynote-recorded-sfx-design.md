# keynote 语义化录音音效库（迁移自 wk-motion-graphics）设计

关联 issue：#43

## 1. 问题与目标

- 现状：keynote 风格的声音只能用 `engine/audio/synth.mjs` 合成（qin / water / knock），示范片《七十二变》只有一声合成的"笃"。
- 用户的 wk-motion-graphics（`wukong-self-media/skills/wk-motion-graphics`）已经定下一套**按场合命名的录音音效**：18 个 Mixkit 录音，每个有固定电平、限长，以及"太密"反馈后定下的密度规则。用户在那边明确要求"用免版税库的录音音效，不用代码合成音效"。
- 目标：keynote 片子的 `audio/build.mjs` 可以按名字（`ding`、`swish`…）在指定时刻放这些录音音效，电平、处理方式与源 skill 一致；音效的选用规则、试听换音流程、剪映音效对照表随之写进 keynote 文档。

## 2. 架构与组件边界

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| 音效清单 | `plugin/skills/keynote/sfx.json`（新） | 18 个音效：名字 → Mixkit 编号、扩展名、英文标题、场合、`maxSeconds`、`level`；另有 `license`、`base`。只提交清单，不提交音频 |
| 风格声明 | `plugin/skills/keynote/style.json` 加 `"sfx": "sfx.json"`；`style.schema.json` 增加可选字符串字段 `sfx` | 让引擎找到该风格的音效清单；其它风格不写就没有录音音效 |
| 音效库模块 | `plugin/engine/audio/sfx.mjs`（新） | 读清单、`--list` 查询远端大小（只发 HEAD）、下载 + 处理到缓存、读处理后文件、往 synth 缓冲里叠加、记录放置并检查密度 |
| 缓存目录 | `~/.wukong-animation/cache/sfx/<风格id>/`（`paths.mjs` 新增 `SFX_CACHE_DIR`） | 原始文件 `raw/<id>.<ext>`，处理后 `<名字>.wav`。和字体一样不进插件、不进 git |
| 命令 | `wka sfx <片目录> [--list]`（`bin/wka.mjs`） | 按片子所用风格的清单：`--list` 打印审批表；不带参数则下载缺的并处理 |
| 配乐脚本上下文 | `soundtrack.mjs` 调用 `audio/build.mjs` 时多传一个 `sfx` 对象 | 风格没有清单时 `sfx` 为 `null` |

镜头组件（`.tsx`）**不**发声：本仓库声音统一在 `audio/build.mjs` 里做（镜头单独渲染、按镜缓存，剪映草稿按文件分轨），与源 skill 把 `<Sfx>` 写在组件里不同。

## 3. 接口、数据与行为

### 3.1 清单 `sfx.json`

```json
{
  "license": "Mixkit Sound Effects Free License (https://mixkit.co/license/#sfxFree) …",
  "base": "https://assets.mixkit.co/active_storage/sfx",
  "sounds": {
    "ding": { "id": 931, "ext": "wav", "title": "Service bell", "role": "说观点", "maxSeconds": 1.5, "level": 0.37 }
  }
}
```

18 个名字、编号、扩展名、标题、场合、`maxSeconds` 原样取自源 `template/scripts/sfx-sources.json`，`level` 原样取自源 `Sfx.tsx` 的 `LEVEL`。下载地址 `${base}/${id}/${id}.${ext}`。

### 3.2 处理（与源 `fetch_sfx.py` 一致）

ffmpeg：`silenceremove=start_periods=1:start_threshold=-50dB` 去前导静音 → `atrim=0:maxSeconds` 限长 → 末尾 60 ms `afade` 淡出 → 单声道；再用 `volumedetect` 测峰值，`volume` 拉到峰值 -1 dBFS。采样率改为 48 kHz（引擎混音统一 48 kHz；源为 44.1 kHz，听感无差）。已存在的原始文件不重复下载；处理后文件比原始文件和清单项旧时重新处理。

### 3.3 `wka sfx`

- `wka sfx <片> --list`：逐条打印 名字 / 场合 / 标题 / 来源 URL / 远端大小，末行合计与许可说明。只发 HEAD 请求，不写文件。
- `wka sfx <片>`：逐条下载、处理，打印 名字、编号、原始大小、处理后时长；某条失败时报出名字和 URL，继续其余，最后以非 0 退出。
- 片子风格没有 `sfx` 声明时报错："风格 X 没有录音音效清单"。
- 下载前必须先 `--list` 给用户确认（写进 keynote 文档，与源 skill 一致）。

### 3.4 `audio/build.mjs` 里的用法

```js
export default async function ({ synth, sfx, duration, outDir, cues }) {
  const buf = synth.buffer(duration);
  sfx.place(buf, 'drop', { at: 0 });
  sfx.place(buf, 'ding', { at: cues['要点一'][0] });
  sfx.place(buf, 'click', { at: 6.4, volume: 0.8 });
  return [{ file: synth.writeWav(buf, `${outDir}/sfx.wav`), start: 0, gain: 0 }];
}
```

- `sfx.place(buf, name, { at, volume = 1 })`：把处理后的录音按 `level × volume` 叠加到 `buf` 的 `at` 秒处（左右声道相同），超出 `buf` 结尾的部分截掉。
- `sfx.names`：可用名字列表。
- 名字不在清单里：报错并列出可用名字。文件还没下载：报错"先运行 `wka sfx <片> --list` 确认后 `wka sfx <片>`"。不静默退回合成音。
- `at < 0` 不放（与源 `Sfx` 一致）。

### 3.5 密度检查（警告，不中断）

`wka soundtrack` 跑完配乐脚本后，按本次 `sfx.place` 的记录打印警告：

- 同一镜头里 `ding` 超过一个（源规则"每页最多一个叮"）。
- 两个音效起点相差不到一帧（1/30 秒）（源规则"同一拍不叠两个强调音""点击不叠别的音效"）。

其余源规则（切镜嗖声只在真正换话题时响、拳击只给真正重点框、出字幕打字声只在每页第一句）依赖语义判断，写进文档，由写 `build.mjs` 的人遵守，不做自动检查。

### 3.6 文档

- `keynote/SFX.md`（新）：语义化音效表（场合 / 音效 / 名字 / Mixkit id / 电平）、密度规则、获取与许可、推荐与试听流程（Mixkit 分类页 → 下预览 mp3 到 scratchpad 发给用户试听 → 用户定编号后改 `sfx.json`）、剪映音效名 → Mixkit 对照表。内容取自源 `references/audio.md` 的对应段落，改成本仓库的命令与文件名。
- `keynote/STYLE.md` §7、`TECH.md`、`SKILL.md`：改为"音效用录音音效库，见 SFX.md"；`TECH.md` 写 `sfx.place` 用法与"拉近放 spring、点击放 click"的位置对应（`zoomInFrames`、`Cursor clicks`）。
- `director/SKILL.md` 第 302 行"只用…自行合成的声音素材"改为"只用开源授权字体；声音用自行合成的，或风格音效清单里明确可商用、按需下载的录音素材"（与 `CONTRIBUTING.md` 已有的"明确可商用的素材"一致）；第 7 道声轨制作提一句"风格有音效清单的，先 `wka sfx`"。
- 示范片《七十二变》`audio/build.mjs`：把合成的 `knock` 换成 `sfx.place(buf, 'dudong', …)`（第 2 个格子点亮属"提示出现"）。

## 4. 约束、兼容性与非目标

- 不提交任何 Mixkit 音频文件（许可禁止再分发）；测试不依赖网络下载。
- 没写 `sfx` 的风格（ink-wash 等）和不用 `sfx` 的 `build.mjs` 行为不变；`build.mjs` 多收一个参数不影响旧脚本。
- 非目标（本次不做）：源 skill 的听感审计 `sfx_audit`、背景音乐合成与逐帧闪避、两遍 loudnorm 母带、组件内自动发声（`CuePoint` / `Cursor` / `SceneShell` 自带音效）。

## 5. 错误处理与运维

- 下载用 curl（与字体下载一致，遵循代理设置），超时 60 秒；ffmpeg 处理失败报出文件名与 ffmpeg 末尾输出。
- 缓存可整目录删掉重下；`WUKONG_ANIMATION_HOME` 覆盖缓存根（测试用）。

## 6. 验收标准与测试

1. 单元测试：`sfx.json` 18 项字段齐全，名字、编号、`maxSeconds`、`level` 与源一致。
2. 单元测试：用本地合成的测试 wav 走处理流程，输出前导静音被去掉、时长 ≤ `maxSeconds`、峰值约 -1 dBFS（±0.2 dB）、48 kHz。
3. 单元测试：`place` 在正确样本位置按 `level × volume` 叠加；越界截断；未知名字、未下载分别报对应错误。
4. 单元测试：密度检查对"一镜两个 ding""同帧两个音效"给出警告，正常情况不警告。
5. 集成测试：构造 keynote 片子 + 预置缓存（测试 wav），`wka soundtrack` 产出 `sfx.wav` 并混音成功；风格无清单时 `wka sfx` 报错。
6. 手动：`wka sfx <片> --list` 打出 18 行真实大小（HEAD）；经用户同意后真实下载一次，`wka soundtrack` 审听《七十二变》。
7. `npm test`、lint 全部通过。
