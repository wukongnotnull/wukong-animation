# 单端口多项目验收

日期：2026-11-09；关联 [#127](https://github.com/wukongnotnull/wukong-animation/issues/127)，规格提交 c4a3097。

## 实现与兼容

`wka workbench <首目录> [其他目录...] --port N` 在同一服务中合并明确指定目录的影片，沿用当前影片选择器。规范路径后去重；影片 ID 相对首目录计算，首工作区旧 ID 不变；同名影片加路径区分。媒体与意见路由仍按各自片目录，不放宽请求来源或文件范围检查。

参数解析消费工作台带值选项，防止端口值进入影片列表；capture/pending/register/repair 多目录组合明确拒绝。原文件、正式审阅记录保留原处，额外项目原先独立工作台的私人草稿不读取、不迁移、不删除。

## 自动验证

- 新增 5 个集成用例先在旧实现失败：只列一片、未校验额外目录、端口混入位置参数、CLI 未转发第二片。修复后 5/5 通过。
- `node --test tests/unit/workbench*.test.mjs tests/integration/workbench*.test.mjs tests/integration/desktop-plugin.test.mjs tests/unit/cli-*.test.mjs`：59/59 通过，0 失败/跳过。
- 覆盖双项目文件读取与意见隔离、未接入项目拒绝、跨片版本拒绝、重复/重叠目录、首工作区 ID 保留、同端口重启、错误路径、CLI 生命周期和既有 Chrome 来源兼容。
- `npm run lint`、`git diff --check` 通过；82 模块无循环。未运行涉及视频生成的全量媒体集合；未生成视频，不替代远程 CI。

## 浏览器与当前服务

停止本会话原 63711、63915 两个单片服务，使用仓库引擎启动：

```sh
node plugin/engine/bin/wka.mjs workbench plugin/skills/ink-wash/examples/chunjiang plugin/skills/keynote/examples/qishier --port 63711
```

在内嵌浏览器与外置 Chrome 的 63711 页面中，下拉切至 qishier 显示 panel.tsx 等该片历史文件，切回 chunjiang 显示 chunjiang_无字幕.mp4 等该片文件；状态均已连接。旧 63915 标签改开 63711，工作台保留供用户使用。没有修改用户影片或意见；此轮验证切换和文件列表，未再次做全片播放。

截图保留在 `/Users/wukong/.codex/visualizations/2026/11/09/01a1c033-2c33-7941-8d90-96681ac67ddb/workbench-multi-project/`，含 project-switcher.jpg 与 chrome-qishier.jpg。截图只捕获页面，原生选择菜单未被捕获；两项选项及切换结果由浏览器状态验证。

## 收尾

仅保留 63711 统一示范服务，63915 已停止；其他任务的工作台服务不动。测试临时目录与子进程随测试清理，用户 outputs/、tmp/ 和截图证据保留。

仅当前 worktree，main 与远程 main 一致；codex/workbench-direct-open 含未合并独立提交而保留，无已合并闲置分支/worktree 可清理。版本不变，未改安装缓存、推送或发布，未同步 Projects。
