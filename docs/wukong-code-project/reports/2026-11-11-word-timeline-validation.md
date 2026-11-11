# 逐词时间表验证报告（2026-11-11）

对应 spec：[逐词时间表](../specs/2026-11-11-2310-word-timeline-design.md)

## 方法

- 真值：macOS `say`（Tingting）逐词合成并拼接，得到每个词的已知起止（28 个词边界）。
- 识别：whisper.cpp + `ggml-small.bin`，DTW 预设 `small`，固定风格提示。
- 流程：完整 `alignWords` → 能量精修，与真值逐边界比较。

## 结果

| 场景 | 比对边界数 | 中位误差 | 最大误差 | ≤50ms |
|---|---|---|---|---|
| 干净音频 | 28 | 8ms | 27ms | 28/28 |
| 加粉红噪声 | 28 | 6ms | 26ms | 28/28 |
| 语速 260 | 28 | 12ms | 29ms | 28/28 |

早期方案（解码器 token 时间 + ±0.12 秒局部吸附）中位误差约 145ms，未达标，已放弃。

## 局限

- 真值音频由孤立词拼接而成，词间边界比真人连续语流清晰；**真人录音的精度尚未验证**。需要用户提供旁白录音（最好带原稿）后听审补充。
- 无 DTW 预设（模型文件被改名）时退回句段 token 时间，精度明显下降。
- 逐字子级时间只是词内细分，不作实测声明。

## 自动化测试

见提交时的测试记录：`tests/unit/word-alignment.test.mjs`、`tests/unit/word-timeline.test.mjs`、`tests/integration/word-timeline.test.mjs`，以及相关既有测试和 `npm run lint`。
