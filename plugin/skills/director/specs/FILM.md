# 工程文件规范（film.json）

> `film.json` 给引擎用，`storyboard.md` 给人看（写法见 `STORYBOARD.md`），两者逐镜对应：分镜表的「镜」栏对应 `shots[].id`，「景别」栏对应 `shots[].size`，「时长」栏对应 `shots[].duration`。

- **工序**：第 2 道 `wka init` 生成，第 4 道起各道工序往里填字段
- **模板**：`engine/templates/film/film.json`
- **完整字段**：`engine/schemas/film.schema.json`，引擎按它校验

## 一、结构一览

```json
{
  "title": "晨雾",
  "style": "ink-wash",
  "size": [1920, 1080],
  "fps": 30,
  "seed": 7,
  "scripts": ["shots/common.js"],
  "shots": [
    { "id": "s01", "file": "shots/s01.js", "duration": 12, "size": "远景", "note": "晨雾山谷" }
  ],
  "cues": { "亭现": [6.2, 6.6] },
  "audio": {
    "build": "audio/build.mjs",
    "voice_source": "user",
    "voices": [{ "text": "雾散时，山就醒了。", "at": 4.5, "cue": "第一句", "file": "audio/voice/01.wav" }],
    "tracks": []
  },
  "export": { "formats": ["mp4"], "name": "chenwu" }
}
```

## 二、常用字段

| 字段 | 说明 |
|---|---|
| `seed` | 全片随机种子。换种子 = 换一版"笔迹"，构图不变 |
| `scripts` | 片内公共脚本（多镜共用的场景画法），在镜头文件之前注入 |
| `shots[].duration` | 秒。第 7 道工序按人声实测时长回填 |
| `shots[].size` | 景别：`大远景` / `远景` / `全景` / `中景` / `近景` / `特写` / `大特写`，与分镜表景别栏一致。第 5 道签批时 `wka signoff --step 5` 检查：每镜都写、4 镜及以上至少 3 种、相邻两镜不同，不合规就拒绝签批 |
| `cues` | 声音同步点 `名: [入点, 出点]`（全片时间，秒）。人声同步点由 `wka soundtrack` 自动写入，音效同步点手写 |
| `audio.build` | 配乐脚本，导出 `default async ({synth, duration, outDir, shots, cues}) => [{file, start, gain}]`。配乐、环境声、音效各返回一个文件（`bgm.wav` / `ambience.wav` / `sfx.wav`），剪映草稿里按文件分轨 |
| `audio.voice_source` | 人声来源：`user` 用户录音 / `none` 无人声；缺录音不生成依赖声音的动画 |
| `audio.voices` | 每段完整用户录音登记一次；`file`、`at`，可选 `text` 原稿及唯一 `cue`。整段录音支持本地句段定位，详见 `../references/LOCAL-SPEECH.md` |
| `voices[].kind` | vo 画外音 / dialogue 对白 / os 画外在场人声 / live 同期声；全部来自用户录音 |
| `voices[].chars` | `true` 时 `wka soundtrack` 给这一句的每个字写同步点 `名#1`、`名#2`……（按停顿分句、句内均分的近似时间），镜头里用 `s.cueChars('名')` 读。题字等屏幕文字要逐字跟着人声出现时用 |
| `voices[].speaker` | 说话的人或声音来源，对应标记括号里的内容，如 `对白（老者）` 写 `"speaker": "老者"` |
| `export.formats` | 已注册的导出器：`mp4` / `gif` / `png-seq` / `jianying`（剪映草稿，直接写进剪映草稿目录；不写进这里，等 ⑤ 成片定版后在第 8 道用 `wka final <片> --formats jianying` 单独导出） |
| `variants` | 副版画幅（第 7 道调整画幅用）：键是画幅，如 `"variants": { "9:16": {} }`；主版画幅就是 `size`。值里可覆盖 `export.name`（缺省为主版名加 `-<后缀>`，如 `chenwu-9x16`）。主版和副版的画幅都必须在风格 `style.json` 的 `aspects` 里。副版尺寸按主版短边等比推出（主版 1920×1080 时 9:16 副版为 1080×1920）；分镜稿、时长、`cues`、声音两版共用。没有这个字段即只出主版 |

旧字段名 `voiceover` / `vo_source` 仍能读取，`wka soundtrack` 会提示改成新名；新旧两个名字同时出现会报错。