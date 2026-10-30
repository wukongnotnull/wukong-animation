# 第三批性能基线（实施中）

状态：哈希组完成，真实制作矩阵运行中；未实现 P2/P3，未比较候选。

基线提交 `5957b73e90f014011fb27d3e015d4987c39db6ba`（v0.19.3），Node v25.8.1，macOS arm64 / Apple M1 Pro。5 轮无读取探针计时，另 1 轮独立探针；9 个场景，共 45 个计时样本、9 个探针。准备与导入不计入哈希操作时间。OS 文件缓存未控制。

| 操作 | 文件 MiB | 中位数 ms | 主 Node 最大 RSS 中位数 MiB | 目标文件完整读取次数 |
| --- | ---: | ---: | ---: | ---: |
| fileDigest | 8 | 5.47 | 63.2 | 1 |
| sourceState | 8 | 30.09 | 74.1 | 2 |
| deliverySnapshot | 8 | 10.85 | 71.4 | 2 |
| fileDigest | 64 | 46.88 | 119.5 | 1 |
| sourceState | 64 | 100.99 | 186.2 | 2 |
| deliverySnapshot | 64 | 81.13 | 183.7 | 2 |
| fileDigest | 256 | 189.79 | 311.6 | 1 |
| sourceState | 256 | 365.21 | 570.1 | 2 |
| deliverySnapshot | 256 | 331.66 | 567.7 | 2 |

RSS 是主 Node 进程生命周期最大常驻内存，包含模块加载，不是读取后增量，也不是整套制作进程树的峰值。目标文件的最大读取请求仍等于整个文件大小。sourceState 对声明且处于 audio 树中的音轨读 2N；deliverySnapshot 的 2N 是必须保留的双遍核对。

真实场景的试运行验证了工具可以识别 0 镜/1 镜重渲。完整基线使用增强后的输出帧数、帧率与首末局部音频区间检查，试运行不替代正式矩阵。

## 执行记录

```bash
node tools/bench-performance.mjs --engine /var/folders/zc/71mnngz96gb6qpm2yznd3n4c0000gn/T/wka-phase3-_q_fm3wp/baseline/plugin/engine --suite hash --rounds 5 --out /var/folders/zc/71mnngz96gb6qpm2yznd3n4c0000gn/T/wka-phase3-_q_fm3wp/hash-baseline-v2
node tools/bench-performance.mjs --engine /var/folders/zc/71mnngz96gb6qpm2yznd3n4c0000gn/T/wka-phase3-_q_fm3wp/baseline/plugin/engine --suite workflow --rounds 5 --out /var/folders/zc/71mnngz96gb6qpm2yznd3n4c0000gn/T/wka-phase3-_q_fm3wp/workflow-baseline
```

原始哈希样本见 [JSON](2026-10-30-performance-phase-three-baseline.json)。真实制作结果完成后补充；不能据当前数据宣称整片提速。
