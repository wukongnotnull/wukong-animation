# remotion 管线（规划中）

调用 Remotion（React）渲染字幕密集、模板化的镜头，直接输出视频片段。注意 Remotion 对较大规模的公司需要商业授权。

接口与 browser 管线一致：`check()` / `renderShots(job, todo, {onDone})` / `renderStills(job, points, outDir)`。
每个镜头输出一个 H.264 片段到 `todo[i].out`，引擎负责缓存、拼接、混音和导出。
