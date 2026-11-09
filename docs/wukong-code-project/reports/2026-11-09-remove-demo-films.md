# 两部示范片删除记录

用户授权：删除当前项目的两部示范片全部内容。规格默认通过，设计与计划见同日 2108 文件；规格提交为 e9ed4a6。

## 删除结果

- 删除 plugin/skills/ink-wash/examples/chunjiang 与 plugin/skills/keynote/examples/qishier 的全部源码、剧本、分镜、字幕、媒体、缓存及审阅记录。
- 删除两张画廊图、Darwin/Linux 对应 18 张灰度基准。合计精确白名单 10 个目标、388 个文件、526,940,964 字节（502.53 MiB，包含未跟踪生成物）。删除前核实仓库与目标真实路径，递归拒绝符号链接。
- 移除当前 catalog/README、STYLE 和制作规范中的示范片内容及入口。水墨与 Keynote 风格模块、通用模板继续保留。
- 停止核实身份后的旧工作台 PID 2007；清除两片注册与 2 个匹配的私人会话键，不输出草稿正文。空工作台在原地址 http://127.0.0.1:63711/ 恢复，根目录为用户工作台的中性 workspace，未来打开影片仍自动加入同一服务。

## 测试调整与验证

测试改用临时生成的三镜几何图形，不搬迁或复制被删除的作品。保留性能工具 example 参数兼容；文档说明新旧素材的性能数字不可直接比较。分轨测试覆盖常规与亚秒时长，音效测试离线覆盖清单全部 18 项。

- TDD：新增 builtin-fixture 测试先因缺少导出失败；实现后校验发现副版 size 不是合法字段，按现有画幅推导规则修正，三项通过。
- node --test tests/unit/score-tracks.test.mjs tests/unit/keynote-sfx.test.mjs tests/unit/variants.test.mjs：29/29 通过，无跳过。
- node --test tests/unit/builtin-fixture.test.mjs tests/unit/performance-benchmark.test.mjs tests/unit/workbench*.test.mjs tests/integration/workbench*.test.mjs：69/69 通过，无跳过。
- npm run smoke：两种风格各首/中/末镜、16:9 与 9:16、重复两次，合计 24 张临时静帧；检查图形位置、前景/背景、尺寸与确定性通过。素材目录随测试清理。
- npm run lint：目录、文档生成一致性及架构检查通过。
- git diff --cached --check 通过；当前 plugin/tests/tools/README/贡献指南/架构说明不再引用两个旧片路径或片名。
- 实际 Chrome 与内置浏览器刷新后均显示“已连接 · 等待加入影片”，影片列表为空。

本次只验证静帧、音频与非视频回归，没有生成视频或运行完整视频矩阵；静帧夹具证明基本渲染，不替代旧示范片的艺术画面基准。未执行 Linux CI，未修改版本或发布。

## 收尾与保留边界

git ls-remote 核实远程仅 main，指向 56fb598，与本地 main/origin/main 一致。仅一个 worktree，为当前占用的工作区；当前 codex/workbench-direct-open 含未合并的独立提交，保留。无闲置已合并分支或 worktree 可清理。

无关未跟踪 outputs/、tmp/ 保留，其中包含既有发布包、其他任务成果及验收证据。Git 既有历史、旧发布归档、已安装插件缓存未改写；历史开发报告保留作为证据。本次清理范围为当前仓库作品及其本地预览登记。
