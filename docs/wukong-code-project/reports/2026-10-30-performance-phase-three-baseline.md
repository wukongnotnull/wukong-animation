# 第三批性能基线

状态：优化前基线完成；候选尚未测量。

冻结引擎 `5957b73e90f014011fb27d3e015d4987c39db6ba`（v0.19.3），Node v25.8.1，macOS arm64 / Apple M1 Pro。哈希 9 个场景、真实制作 48 个场景；每场景 5 轮无读取探针计时，另 1 轮独立探针。合计 285 次计时、57 次探针，零失败。准备、缓存复原与输出校验不计入命令耗时；哈希操作时间另外排除模块导入。

读取量为主 Node 显式同步文件 API 的逻辑字节，排除模块加载器、原生库与子进程 I/O。完整读取次数不一概等同哈希次数；表中非空目标音轨的完整读取对应哈希遍数。子进程墙钟可能重叠，不能相加作为互斥耗时组成。OS 文件缓存未控制或清理。

RSS 是主 Node 进程生命周期最大常驻内存，包含模块加载；CPU 为主 Node 进程及其线程，不包含浏览器/ffmpeg 子进程。这里没有整套进程树峰值。

## 哈希与状态

| 操作 | 中位数 ms | 主 Node 最大 RSS 中位数 MiB | 目标完整读取次数 | 最大读取请求 MiB |
| --- | ---: | ---: | ---: | ---: |
| fileDigest-8MiB | 5.47 | 63.2 | 1 | 8 |
| sourceState-8MiB | 30.09 | 74.1 | 2 | 8 |
| deliverySnapshot-8MiB | 10.85 | 71.4 | 2 | 8 |
| fileDigest-64MiB | 46.88 | 119.5 | 1 | 64 |
| sourceState-64MiB | 100.99 | 186.2 | 2 | 64 |
| deliverySnapshot-64MiB | 81.13 | 183.7 | 2 | 64 |
| fileDigest-256MiB | 189.79 | 311.6 | 1 | 256 |
| sourceState-256MiB | 365.21 | 570.1 | 2 | 256 |
| deliverySnapshot-256MiB | 331.66 | 567.7 | 2 | 256 |

sourceState 对声明且处于 audio 树中的音轨读 2N；deliverySnapshot 的 2N 是必须保留的双遍核对。

## 真实制作

两条例片保留仓库画面脚本，替换为本地确定 PCM：《春江》前 6 镜共 42.54 秒，《七十二变》4 镜共 14 秒。长片均为 107 镜 × 2.05 秒 = 219.35 秒、512×288、30fps，日常小样按原规则为 15fps。大音轨为有效 48kHz 双声道 16bit WAV（256 MiB PCM 数据加 44 字节头），混音区间为 0 至片长；不使用伪 WAV 作制作输入。

每次无修改/改单镜均独立复原已完成快照；确认重渲镜数为 0/1，首次为完整镜数。输出逐个核对尺寸、帧率、帧数和音频流，并核对首末局部预览音频区间。长片校验边界从真实 final 命令生成的技术证据开始，没有伪造用户签批；delivery --final 保持未批准并返回 2，仅写约定报告，核心报告和 resume 只读。

| 场景 | 中位数 s | 范围 s | CPU 中位数 s | 主 Node 最大 RSS MiB | 音轨完整读取次数 |
| --- | ---: | --- | ---: | ---: | ---: |
| browser-example-preview-cold | 15.03 | 14.60–15.35 | 2.22 | 177.8 | 14 |
| browser-example-preview-unchanged | 0.31 | 0.30–0.31 | 0.22 | 115.4 | 14 |
| browser-example-preview-single | 1.40 | 1.34–1.56 | 0.72 | 236.7 | 14 |
| browser-example-render-cold | 14.96 | 14.86–15.54 | 2.08 | 188.4 | 10 |
| browser-example-render-unchanged | 2.01 | 2.01–2.10 | 0.23 | 114.3 | 10 |
| browser-example-render-single | 3.12 | 3.08–3.41 | 0.76 | 208.6 | 10 |
| browser-long-preview-cold | 34.45 | 34.22–35.54 | 15.70 | 289.5 | 216 |
| browser-long-preview-unchanged | 7.42 | 7.38–7.49 | 7.81 | 190.9 | 216 |
| browser-long-preview-single | 8.78 | 8.39–8.87 | 11.57 | 259.6 | 216 |
| browser-long-render-cold | 22.43 | 21.94–23.06 | 4.62 | 292.2 | 10 |
| browser-long-render-unchanged | 3.95 | 3.89–4.03 | 0.69 | 198.8 | 10 |
| browser-long-render-single | 4.63 | 4.44–4.85 | 1.20 | 270.4 | 10 |
| browser-long-resume | 0.28 | 0.25–0.30 | 0.21 | 193.4 | 3 |
| browser-long-qc | 2.34 | 2.26–2.52 | 0.83 | 206.9 | 2 |
| browser-long-delivery | 0.48 | 0.46–0.52 | 0.43 | 198.3 | 6 |
| browser-large-audio-preview-cold | 63.94 | 63.42–65.35 | 47.83 | 720.9 | 216 |
| browser-large-audio-preview-unchanged | 36.17 | 35.97–36.86 | 36.32 | 612.7 | 216 |
| browser-large-audio-preview-single | 37.79 | 37.61–37.93 | 43.60 | 681.1 | 216 |
| browser-large-audio-render-cold | 25.19 | 24.50–25.42 | 6.38 | 876.3 | 10 |
| browser-large-audio-render-unchanged | 5.52 | 5.31–5.67 | 2.09 | 843.8 | 10 |
| browser-large-audio-render-single | 6.23 | 5.97–6.77 | 2.69 | 899.8 | 10 |
| browser-large-audio-resume | 0.76 | 0.68–0.84 | 0.64 | 624.7 | 3 |
| browser-large-audio-qc | 2.68 | 2.63–2.85 | 1.15 | 670.0 | 2 |
| browser-large-audio-delivery | 1.34 | 1.30–1.39 | 1.24 | 666.5 | 6 |
| remotion-example-preview-cold | 24.56 | 24.24–25.07 | 12.92 | 1161.1 | 10 |
| remotion-example-preview-unchanged | 0.22 | 0.22–0.25 | 0.13 | 82.0 | 10 |
| remotion-example-preview-single | 10.66 | 10.25–11.29 | 8.55 | 771.4 | 10 |
| remotion-example-render-cold | 24.51 | 24.25–24.90 | 12.85 | 1101.8 | 10 |
| remotion-example-render-unchanged | 1.13 | 1.07–1.19 | 0.18 | 85.0 | 10 |
| remotion-example-render-single | 11.65 | 10.86–11.72 | 8.59 | 751.1 | 10 |
| remotion-long-preview-cold | 227.79 | 227.15–236.35 | 40.31 | 1125.6 | 216 |
| remotion-long-preview-unchanged | 7.27 | 7.19–7.39 | 7.67 | 191.5 | 216 |
| remotion-long-preview-single | 12.91 | 12.21–13.18 | 16.75 | 676.6 | 216 |
| remotion-long-render-cold | 214.00 | 213.72–215.04 | 26.30 | 1152.5 | 10 |
| remotion-long-render-unchanged | 3.85 | 3.77–3.90 | 0.66 | 201.0 | 10 |
| remotion-long-render-single | 7.56 | 7.52–8.61 | 3.50 | 792.0 | 10 |
| remotion-long-resume | 0.27 | 0.25–0.31 | 0.20 | 193.3 | 3 |
| remotion-long-qc | 2.07 | 1.97–2.15 | 0.78 | 221.9 | 2 |
| remotion-long-delivery | 0.47 | 0.45–0.48 | 0.42 | 199.7 | 6 |
| remotion-large-audio-preview-cold | 254.84 | 254.52–255.80 | 74.17 | 1166.1 | 216 |
| remotion-large-audio-preview-unchanged | 35.26 | 35.17–35.48 | 35.85 | 614.5 | 216 |
| remotion-large-audio-preview-single | 40.92 | 40.86–41.44 | 50.45 | 968.4 | 216 |
| remotion-large-audio-render-cold | 216.33 | 216.11–216.44 | 27.59 | 1208.2 | 10 |
| remotion-large-audio-render-unchanged | 5.28 | 5.27–5.58 | 2.03 | 843.6 | 10 |
| remotion-large-audio-render-single | 9.84 | 9.49–10.09 | 5.08 | 1113.2 | 10 |
| remotion-large-audio-resume | 0.81 | 0.75–0.91 | 0.67 | 618.5 | 3 |
| remotion-large-audio-qc | 2.43 | 2.37–2.61 | 1.11 | 677.2 | 2 |
| remotion-large-audio-delivery | 1.31 | 1.29–1.41 | 1.24 | 670.1 | 6 |

无修改的 107 镜局部预览在两条管线中均完整读取音轨 216 次；大音轨约为 54 GiB 逻辑读取。该场景没有重渲、完整视频探测或 ffmpeg 进程，支持继续有界哈希和单次状态观察去重。首次 Remotion 长片仍主要花费在实际渲染，不能据哈希诊断承诺整片倍数提速。

## 复跑与证据

```bash
node tools/bench-performance.mjs --engine /var/folders/zc/71mnngz96gb6qpm2yznd3n4c0000gn/T/wka-phase3-_q_fm3wp/baseline/plugin/engine --suite hash --rounds 5 --out /var/folders/zc/71mnngz96gb6qpm2yznd3n4c0000gn/T/wka-phase3-_q_fm3wp/hash-baseline-v2
node tools/bench-performance.mjs --engine /var/folders/zc/71mnngz96gb6qpm2yznd3n4c0000gn/T/wka-phase3-_q_fm3wp/baseline/plugin/engine --suite workflow --rounds 5 --out /var/folders/zc/71mnngz96gb6qpm2yznd3n4c0000gn/T/wka-phase3-_q_fm3wp/workflow-baseline
```

命令记录使用当时的测量工具。复跑须使用全新输出目录；工具原文与摘要随原始证据保存。后续配对测量会固定改进后的同一工具，不把不同工具版本的历史耗时直接当优化收益。

完整原始样本、计数探针、命令日志、输入/运行时身份及准备耗时见 [归档](assets/performance-phase-three/baseline.tar.gz)，SHA-256 `5766890e91b011278b02acf8a0b4d7cdb73c96c172d1d6e7bf5974ac221e77c1`。摘要及哈希原始数据见 [JSON](2026-10-30-performance-phase-three-baseline.json)。

历史探针曾将“只打开、未读取的空输出文件”记成零字节完整读取。非空目标音轨的读取量及所有无探针计时不受影响；原始数据原样保留。后续工具修正该统计、补充锁文件验证、字体身份、摘要一致性与超时后代进程清理；这不构成生产性能改动。
