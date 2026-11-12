# 本地录音定位

首版使用 whisper.cpp 的 CPU 路径，输入是用户已有录音。准备组件、下载模型需要联网；运行识别只读取本地文件，不上传录音或台词。识别耗时与设备和模型有关，不承诺固定速度。

## 首次准备

按 [whisper.cpp 官方说明](https://github.com/ggml-org/whisper.cpp#quick-start) 安装构建工具并准备 `whisper-cli`。macOS/Linux 可从源码使用 CMake 构建，Windows 使用官方 Windows 构建说明或发布的本地程序。为中文使用多语言模型，不能使用仅英文的 `.en` 模型；模型来自官方仓库列出的下载脚本或模型地址。示例：

```sh
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build -DGGML_METAL=OFF -DGGML_CUDA=OFF
cmake --build build --config Release
bash models/download-ggml-model.sh base
```

Windows 可按官方说明下载模型，使用 `build/bin/Release/whisper-cli.exe` 的实际位置。插件不假定已装 Homebrew、Python 或 GPU。记录实际程序/模型位置，然后在影片上执行：

```sh
wka align-voice <片目录> --prepare --binary <whisper-cli的绝对路径> --model <ggml-base.bin的绝对路径>
wka align-voice <片目录>
```

也可设置 `WKA_WHISPER_BIN`、`WKA_WHISPER_MODEL`。准备结果保存在本片 `.wka/local-speech.json`；组件或模型缺失会说明原因，不自动切换在线服务。下载或环境准备失败可以直接使用下面的人工时间点。

## 录音、原稿与结果

每段完整录音在 `film.json.audio.voices[]` 只登记一次：`file` 是相对片目录的路径，`at` 是在影片里的起点，`cue` 是唯一名称，`text` 是可选原稿。原文件不切分、不覆盖、不变速；总时长冲突先请用户确认。

识别输出保存在 `.wka/voice-alignment.json`，可读结果在 `review/台词/台词定位.md`。采用真实识别句段时间戳，再与原稿保序匹配；不是强制对齐，也不用原稿提示词伪造已识别内容。方法分别记录 `local-recognition`、`local-recognition-text-match` 或 `manual`。低可信、重复和不一致保持 pending，不能用于完整小样签批。即使 matched，最终仍需随小样听审，不能声称达到逐字精确。

定位得到 `speech:<cue>:<序号>` 同步点，供镜头和配乐使用。不生成、导入或输出 SRT/VTT；原稿文字不是字幕。逐字需求须另有经过核实的词锚点，不能把句段时间平均分给每个字后声称实测。

## 人工补点

先运行 `wka align-voice <片目录> --status` 获取当前每段的 `source`。复制待修正段的完整 source 到 JSON，保留录音、原稿摘要、起点与时长。格式为 `{"version":1,"voices":{"录音cue":{"source":当前来源对象,"segments":[{"text":"台词","start":0,"end":1.2}]}}}`。start/end 是相对该录音的秒数，必须有序、不重叠且不越界。

用户实际听审并明确确认后，运行 `wka align-voice <片目录> --import <时间点.json> --confirm "实际用户确认说明"`。若录音与批准剧本不同，先向用户说明差异并确认调整，不能自动改稿。不得预填确认冒充用户意见。

录音、原稿或 at 改变后旧点过期。更换某段只影响该段定位；模块只清理自己创建的 cue，保留其他手工标记。状态查询不会运行识别；无需改变的已匹配或已确认结果可复用。

## 逐词时间表

`wka align-voice` 句段定位完成后默认生成逐词时间表；词表失败只打印警告，不改变句段结果与退出码。`--words` 只重算词表，`--words --status` 查看词表状态。

- **模型要求**：词级精度依赖 whisper.cpp 的 DTW。模型文件须保留官方文件名（如 `ggml-small.bin`、`ggml-base.bin`），插件按文件名选择 DTW 预设；重命名的模型退回句段 token 时间，精度明显下降。中文建议 small 及以上多语言模型。含汉字原稿时自动加固定风格提示，避免输出繁体。
- **切词**：用 `Intl.Segmenter('zh')`，标点不计时；每个词带逐字子级时间，逐字只是词内细分，精度低于词边界。
- **文件**：数据 `.wka/word-timeline.json`，可读表 `review/台词/逐词时间表.md`（序号、词、全片起止、时长、前停顿、置信度、状态）。
- **状态**：`measured`（比对一致且置信度足够）、`pending`（有字对不上、缺失或置信度不足）、`confirmed`（用户听审后确认）。pending 与过期的词不注册 cue。
- **cue**：`word:<录音cue>:<序号>`，序号每段录音从 1 起。镜头用 `s.cueFrame/cueIn/cueOut`；`audio.build` 的 `cues` 里同名键为全片秒 `[起, 止]`。词 cue 不写进 `film.json`；镜头用到不可用词时渲染报明确错误，不改用估算时间。
- **人工确认**：先 `--words --status` 取当前 `source`，格式为 `{"version":1,"voices":{"录音cue":{"source":当前来源对象,"words":[{"n":3,"text":"词","start":1.2,"end":1.5}]}}}`，只覆盖列出的词，且必须绑定当前 `source`；用户听审并明确确认后运行 `wka align-voice <片目录> --import <时间点.json> --confirm "实际用户确认说明"`。
- **精度**：合成真值音频上中位误差约 10ms；真人连续语流未经验证，词表 matched 仍需随小样听审，不能声称逐词精确。
