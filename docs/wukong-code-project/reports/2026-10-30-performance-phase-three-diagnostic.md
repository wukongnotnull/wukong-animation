# 第三批性能优化初步诊断

日期：2026-10-30；基线 `5957b73e90f014011fb27d3e015d4987c39db6ba` / v0.19.3。关联 [#113](https://github.com/wukongnotnull/wukong-animation/issues/113)。这是规格依据，不是优化后验收报告。

## 范围与方法

Apple M1 Pro、10 逻辑核、16 GiB，macOS arm64，Node 25.8.1。使用临时目录构造 107 个短镜头源码，film.json 声明同目录 audio/track.wav；分别写入 8/64/256 MiB 的固定 `0x5a` 二进制内容。该文件仅借用 .wav 文件名，**不是可解码音频**；没有运行渲染、编码、ffprobe 或制作命令。

每种大小分别调用当前 `fileDigest`、`sourceState`、`deliverySnapshot`，各 3 次，共 27 次串行诊断。每次使用新 Node 子进程，导入完成后开始计时；包装 readFileSync 记录返回的逻辑字节与读取次数，并在读取返回时采样该 Node 的 RSS。没有清理系统文件缓存，没有测物理磁盘流量或整套子进程内存；计数包装增加的开销没有剔除。因此时间/RSS 仅供定位，不能与今后的无探针端到端测量直接比较。

临时输入已删除，产品代码、已安装插件和客户作品均未修改。[原始 27 行数据](2026-10-30-performance-phase-three-diagnostic.json)保留各次结果、CPU、环境与方法。复做该诊断需按上述夹具/字节和新进程条件生成输入；真正可重复的制作基准工具属于待批准计划的任务 1。

## 结果

下表为 3 次中位数；“采样 RSS 增量”是每次读取后所采到的最大 RSS 减计时前 RSS，不是操作系统统计的峰值，也不是进程树合计。

| 文件 MiB | 操作 | 音轨完整读取次数 | 逻辑读取 MiB | 最大单次读取 MiB | 耗时 ms | 采样 RSS 增量 MiB |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | fileDigest | 1 | 8 | 8 | 6.05 | 8.14 |
| 8 | sourceState | 2 | 16.016 | 8 | 38.69 | 22.77 |
| 8 | deliverySnapshot | 2 | 16 | 8 | 11.03 | 16.23 |
| 64 | fileDigest | 1 | 64 | 64 | 51.42 | 65.02 |
| 64 | sourceState | 2 | 128.016 | 64 | 109.68 | 135.08 |
| 64 | deliverySnapshot | 2 | 128 | 64 | 89.84 | 128.86 |
| 256 | fileDigest | 1 | 256 | 256 | 302.34 | 255.03 |
| 256 | sourceState | 2 | 512.016 | 256 | 437.10 | 519.06 |
| 256 | deliverySnapshot | 2 | 512 | 256 | 368.94 | 512.95 |

每组 sourceState 中，第一个镜头也被读取两次。源码对应路径：先哈希 film 的 scripts/shots/audio 引用，再 treeEvidence 扫 shots/audio。稳定输入下，两种投影都应保留，但没有必要在同一次同步观察内重复计算同路径内容摘要。

deliverySnapshot 的第二遍不同：现有代码比较两次完整扫描结果以拒绝中途变化。优化只能减少每次哈希的缓冲区，不能把这两次读取合并为一次。视频检查前后的内容复读也同理。

## 尚未证明的内容

- 真实有效大音轨、107 镜长片的端到端耗时，以及无修改/单镜修改时哈希与完整解码的占比，均待正式基准。
- 没有测试优化实现，不存在“已降低内存”或“已提速”的结论；也没有风扇、温度、能耗数据。
- 未改同步 ffprobe、全引擎/系统字体扫描或多交付槽位观察。是否继续优化这些部分，要由后续基准支持。
- 历史 v0.19.0 的 6 镜性能结果不能当作本次 v0.19.3 长片基线。

## 现有行为基线检查

实际执行：`node --test tests/unit/shot-hash.test.mjs tests/unit/operations.test.mjs tests/unit/final-delivery.test.mjs tests/unit/render-performance.test.mjs`。

结果：32/32 通过，失败/跳过/取消/待办均 0，约 2.83 秒。这是既有测试，不是计划内新增失败回归。未在本草案轮次运行完整 484 项回归、严格剪映、视觉或长片矩阵，因为运行时代码未变。

建议下一步：审阅[规格](../specs/2026-10-30-2309-performance-phase-three-design.md)与[计划](../plans/2026-10-30-2310-performance-phase-three.md)，批准后从测量工具和真实基线开始。
