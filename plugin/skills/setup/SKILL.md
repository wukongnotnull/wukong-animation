---
name: setup
description: 用户首次安装 wukong-animation、要求安装或检查本地制作环境，或遇到 Node.js、ffmpeg、Chromium 与渲染依赖缺失，以及询问插件版本、安装来源、升级失败时使用。
---

# 配置本地制作环境

本文件位于 `<插件根目录>/skills/setup/SKILL.md`。先取得**当前加载的本文件所在目录的真实路径**，再上移两级目录得到插件根目录，使用其中的 `engine/bin/wka.mjs`，不要依赖宿主的插件路径变量或固定的源码仓库路径。

1. 确认能访问本地终端与文件，并检查 `node --version`。需要 Node.js 20 或更高版本；没有 Node 或版本过低时，给出 [Node.js 下载页](https://nodejs.org/)，请用户安装后再继续。没有本地执行能力时说明需要桌面本地执行环境。
2. 用户选择「设置」或明确请求配置环境时，运行下列命令。它按插件自带的锁文件安装 npm 依赖，放在 `~/.wukong-animation/deps/<引擎版本>/<环境与锁身份>/`；设置了 `WUKONG_ANIMATION_HOME` 时使用该目录。Chromium 由锁定的 Playwright 安装到其浏览器缓存。旧版依赖目录保留，升级到新的锁身份后第一次需要运行 setup；同身份已完成的安装会复用。如果用户只要求检查，不运行 `setup`，直接执行下一步。

   ```bash
   node "<插件根目录>/engine/bin/wka.mjs" setup
   ```

3. 运行检查，把日志中的必需项与可选项整理给用户；下载或安装失败时保留错误，不声称环境已就绪。

   ```bash
   node "<插件根目录>/engine/bin/wka.mjs" check
   ```

4. 缺少外部工具时，按用户操作系统给出安装方式：

   | 工具 | 用途 | 安装方式 |
   |---|---|---|
   | ffmpeg（必需） | 编码与混音 | macOS：`brew install ffmpeg`；Ubuntu：`sudo apt install ffmpeg`；Windows：`winget install ffmpeg` |
   | git（推荐） | 审片定版存档 | [git-scm.com](https://git-scm.com/) |
   | fonttools（推荐） | 中文字体子集化 | `pip install fonttools brotli` |
   | edge-tts / kokoro（可选） | AI 配音 | `pip install edge-tts` |

   不替用户执行需要管理员权限的安装命令；让用户执行给出的命令后重新检查。

把 `<插件根目录>` 替换为实际绝对路径并保留引号。不要在插件缓存中运行 `npm install`、生成影片或修改插件源码。只有 `check` 成功才报告环境就绪，并告诉用户可以说「用 wukong-animation 拍一支 20 秒水墨短片」开始制作。


## 版本与升级诊断

用户询问插件版本、安装来源或升级失败时，先从当前加载的本文件真实路径定位插件根目录，运行只读诊断：

```bash
node "<插件根目录>/engine/bin/wka.mjs" check --upgrade --json
```

按结果说明插件版本、引擎版本、包格式、依赖状态及对应升级指引。远端最新版本和宿主是否已重载无法由离线诊断确认；不要声称已是最新版。发现其他 marketplace 路径失效时指出具体条目，请用户核对，不自动删除或改写其他插件配置。仅请求诊断时不运行 setup 或更新命令；更新操作仍按用户明确授权执行。诊断不是媒体环境检查，需要确认制作环境时继续运行上面的普通 check。
