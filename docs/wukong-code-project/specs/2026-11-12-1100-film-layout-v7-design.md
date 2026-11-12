# 影片目录布局 v7（工程 flow 7）

## 背景

真实影片 `Fable5.2测评`（3.7G）暴露的结构问题：根目录混放源文件、生成物和智能体写的附属文档；成片 `out.mp4` 与主画幅无标记；`.cache` 里放着不能重新生成的状态；`review/` 根下 49 项平铺且被整个忽略；`stills/` 与 `review/` 重叠；素材重复存放；缓存与版本副本没有占用提示。

## 决定（均经用户确认）

1. 工程 `FLOW` 6→7。新布局是唯一布局，不保留新旧两套路径；flow 6 及更早的影片按现有机制只读，不迁移、不兼容读取。
2. 根目录只留引擎认的源文件：`film.json`、`brief.md`、`story.md`、`storyboard.md`、`sync-points.json`。
3. 成片进 `成片/`，默认文件名 `<片名>-<画幅>.<扩展名>`，`film.json` 的 `export.name` 可覆盖前缀；剪映草稿等其他格式的导出物也放这里。
4. 所有画幅的输出产物统一带画幅标记（主版也带，如 `-9x16`）：成片、小样、QC 报告、缓存目录 `.cache/<画幅>/`。镜头源文件不变：主版 `s001.tsx`，副版覆盖 `s001.16x9.tsx`。
5. `.cache` 只放可删除物。`operations.json`、`main-check.json`、`voice-sources.json`、`approved/`、用户审阅批注 `review-notes.json` 移入 `.wka/`。`render-speed.json` 随渲染缓存留在 `.cache`。
6. `review/` 合并 `stills/`，按类型分子目录：`小样/`、`静帧/`、`QC/`、`声轨/`、`素材/`、`交付/`、`台词/`；未归类的报告留在 `review/` 根。`delivery-manifest.json` 进 `review/交付/`。`.gitignore` 只忽略 `review/` 内的大媒体，文字报告纳入版本管理。
7. 输入素材：图片视频 `media/`，录音 `audio/voice/`，文字资料 `资料/`（含智能体写的附属文档），辅助脚本 `scripts/`；不再出现 `参考/`。
8. `wka materials` 记录来源路径与哈希，同哈希已在 `media/` 或 `audio/voice/` 时不重复复制，单个素材超过 20MB 且未用 LFS 时提醒。
9. `wka status` 显示各目录占用；`wka clean --deep` 先列清单，确认（`--yes`）后才删，不删被签批、批注或交付账本引用的版本副本。
10. 账本格式不变，压缩另立一版。

## 不做

旧片迁移或兼容；自动删除；账本压缩；对 `Fable5.2测评` 的任何改动。

## 版本

插件 v0.24.0、导演流程 v1.23.0、工程 flow 7，引擎包保持 0.2.0（用户已同意）。

## 验证

单元与集成测试覆盖路径布局函数、画幅命名、状态文件位置、`review/` 分类、`.gitignore` 段落、素材查重、`status` 占用与 `clean --deep`；整套 `npm test`、`lint`、`smoke`、`test:jianying`。
