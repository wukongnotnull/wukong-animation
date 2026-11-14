# wukong-animation · 代码七十二变

> 讲一个故事，助手帮你拍成一支动画短片。
> 每一帧画面都由代码"画"出来，不用任何 AI 视频生成模型。

<!-- progress -->
**已修成 2 / 72 变**
<!-- /progress -->

## 它能帮你做什么

你只需要用一句话说出想拍什么，比如"一个关于秋天离别的水墨短片，20 秒"。
助手会像一位导演一样，陪你从构思一路做到成片：

- **出方案**：根据你的故事推荐几套画风，你挑一套；
- **写脚本、画分镜**：先给你看文字脚本和分镜，你满意了再往下做；
- **制作人声**：接入你自己录的旁白或对白，核对台词并试听确认，再规划镜头；
- **出成片**：输出 MP4 视频（也可以导出 GIF）。
- **集中审阅**：本地工作台按阶段预览交付物、定位批注、切换历史版本，回到对话签批；支持从对话集中处理返修意见，见[工作台说明](docs/WORKBENCH.md)。

每到关键环节，Claude 都会**停下来请你过目**，你说"可以"才继续；不满意就直接说哪里要改。

## 开始之前，你需要准备

1. **桌面执行环境**：Claude Code、Codex，或支持本地插件和本地执行的 ChatGPT 桌面环境。需要能运行终端命令、读写所选工程目录；ChatGPT 网页 / 手机端不在本次支持范围内。
2. **Node.js 20 或更高版本**：[nodejs.org](https://nodejs.org/) 下载安装即可。
3. **ffmpeg**（用于生成视频和处理声音），在终端里运行对应命令安装：

| 系统 | 安装命令 |
|---|---|
| macOS | `brew install ffmpeg` |
| Windows | `winget install ffmpeg` |
| Ubuntu | `sudo apt install ffmpeg` |

下面几样不装也能用，装了体验更好：

| 工具 | 有什么用 | 安装方式 |
|---|---|---|
| git | 每次你确认一个环节，都会自动存一个版本，改坏了可以随时退回 | [git-scm.com](https://git-scm.com/) |
| fonttools | 让中文字体文件更小，渲染更快 | `pip install fonttools brotli` |
| whisper.cpp 与多语言模型 | 在本机定位用户录音中的台词；可手工补时间点 | [本地语音准备](plugin/skills/director/references/LOCAL-SPEECH.md) |

> 不确定装好了没有？装完插件后，对 Codex / ChatGPT 说「用 wukong-animation 检查并配置环境」；Claude Code 运行 `/wukong-animation:setup`。它会逐项检查，并告诉你还缺什么、怎么装。

## 安装

### Codex / ChatGPT 桌面本地环境

插件包含通用 Agent Plugins 清单、Codex 兼容清单和 `film`、`setup`、`styles` 技能。ChatGPT 桌面端需要使用能访问本地终端与文件的执行环境；安装插件不会自动赋予本地执行能力。

在终端运行：

```bash
codex plugin marketplace add wukongnotnull/wukong-animation
codex plugin add wukong-animation@wukong-animation
```

第一行添加来源，第二行安装并启用插件；需要提供 `codex plugin` 命令的 Codex 版本。也可在桌面端的插件目录中选择 `wukong-animation` 来源，安装并启用同名插件。安装后打开新聊天；若桌面端还没发现本地来源，重启应用后再检查。

改动尚未发布时，从一份包含本次改动的**干净副本**试装，把第一行换成 `codex plugin marketplace add /绝对路径/wukong-animation`；不要直接从含示范片成片与本机依赖的开发目录安装。干净副本的准备方式见 [贡献指南](docs/CONTRIBUTING.md#桌面插件本地试装)。

安装后先选择插件的「设置」入口，或发消息：

```text
用 wukong-animation 检查并配置本地制作环境
```

设置成功后，选择作品要保存的工程目录，再说：

```text
用 wukong-animation 拍一支关于秋天离别的水墨短片，20 秒
```

浏览画风可以说「用 wukong-animation 推荐适合产品发布的动画风格」；继续制作可以说「用 wukong-animation 继续这个目录里的片子」。这些入口通过 skills 提供，不依赖 Claude 的斜杠命令。

### Claude Code

打开 Claude Code，依次输入下面三行（每行回车一次）：

```
/plugin marketplace add wukongnotnull/wukong-animation
/plugin install wukong-animation@wukong-animation
/wukong-animation:setup
```

- 第 1 行：添加插件来源；
- 第 2 行：安装插件；
- 第 3 行：下载渲染需要的浏览器内核和依赖包（放在 `~/.wukong-animation/` 里，以后升级插件不用重新下载）。

第一次运行 `setup` 需要下载一些文件（依赖包约 230 MB，另有浏览器内核），请耐心等它完成。

### 其他 Agent 工具

Cursor、Copilot、Gemini CLI、OpenCode、Roo Code 等工具使用同一份完整技能包，引擎和风格随包安装。下载 [v0.25.0 发布包](https://github.com/wukongnotnull/wukong-animation/releases/tag/v0.25.0) 里的 `wukong-animation-agent-skills-v0.25.0.zip` 和 `SHA256SUMS`。安装、更新、卸载及逐平台验证边界见 [Agent 安装指南](docs/agent-installation.md)。

## 拍你的第一支片

在 Claude Code 里输入：

```
/wukong-animation:film 一个关于秋天离别的水墨短片，20 秒
```

后面的话换成你自己的故事就行。没想好也可以只输入 `/wukong-animation:film`，助手会先问你想拍什么。

### 整个过程是什么样的

制作分为 9 道工序，最多 8 个审片节点；调整画幅与剪映草稿按需要执行。

| 工序 | 交付物 | 你要检查什么 |
|---|---|---|
| 1 · 制作准备 | 环境检查结果 | 确认本机可以制作 |
| 2 · 确定方案 | 方案简报 | 用途、内容、画幅、时长与美术方向 |
| 3 · 编写剧本 | 剧本 | 内容与表达 |
| 4 · 制作人声 | 人声录音与定位结果 | 试听完整录音、核对稿件与句段时间 |
| 5 · 规划镜头 | 分镜稿 | 镜头安排与节奏 |
| 6 · 制作小样 | 小样视频 | 完整画面、动画、声音和剪辑节奏 |
| 7 · 制作成片 | 成片视频 | 最终画质、声音与检查结果 |
| 8 · 调整画幅 | 横屏成片／竖屏成片 | 另一画幅的构图与主版不变检查 |
| 9 · 导出剪映草稿 | 剪映草稿 | 在剪映中打开、检查分轨和素材 |

人声先独立试听签批，再按真实录音规划镜头；分镜图按需在制作小样时绘制，配乐、音效、环境声、完整混音与剪辑在小样环节完成。工作台用于预览、批注和审阅。

需要你选择或签批的地方，助手会使用当前宿主支持的选择卡片；工具不可用时会列出文字选项，等你明确回复。想说得更具体，可以直接补充意见。在任何一个节点，你都可以直接说出修改意见，比如"第二个镜头再慢一点""山的颜色淡一些"，助手会改好再给你看。

### 成片在哪里

作品默认保存在当前目录下的 `films/<片名>/`。成片在 `成片/`（如 `成片/春晓-16x9.mp4`），小样及检查结果位于 `review/` 的小样、QC 等子目录，助手会提供可点击的文件链接。工作台可以集中查看方案简报、剧本、分镜稿、小样与成片。

### 用户录音与本地台词定位

支持整段或多段用户录音。第 4 道先检查录音、核对稿件，在本机定位句段并默认生成词表，试听签批后再规划镜头。词表待确认不阻塞人声通过，但不可被镜头引用。无任何人声且明确 none 时自动跳过；缺少需要的录音时暂停。声稿冲突由你选择重录或修改剧本并重新确认；画面按完整录音实长编排，不裁切、不变速，超过已批片长限制由你决定。详见 [本地语音准备](plugin/skills/director/references/LOCAL-SPEECH.md)。

当前流程不提供 AI 人声或字幕制作、导入与导出；画面标题和题字仍可使用。

### 做到一半关掉了怎么办

新流程项目可以继续制作。下次在**同一个目录**里说「用 wukong-animation 继续制作」（Claude Code 也可输入 `/wukong-animation:film`），助手会发现在制的片子，问你是接着做还是新开一支。

旧 flow 7 及更早项目只读留档，原文件、成片与审阅记录保留。继续原片需要另行迁移，本次不提供迁移能力。需要续作时新建一支片子，复用素材并重新审阅，不自动迁移或继承旧签批。

## 72 种风格

目前已经可以使用的是**加粗**的风格，其余正在陆续制作中。

<!-- gallery -->
| 分类 | 风格（加粗 = 已可用） |
|---|---|
| 东方神韵 | **水墨写意** · 工笔重彩 · 敦煌壁画 · 皮影戏 · 剪纸 · 木版年画 · 青花瓷 · 走马灯 · 书法笔势 |
| 手绘绘画 | 铅笔速写 · 水彩晕染 · 油画厚涂 · 蜡笔童趣 · 粉笔黑板 · 炭笔素描 · 点彩派 · 浮世绘 · 丝网版画 |
| 平面排版 | 瑞士国际主义 · 包豪斯几何 · 动态字体 · 构成主义海报 · 孟菲斯 · 极简线条 · 拼贴 · 杂志版式 · 霓虹招牌 |
| 卡通漫画 | 赛璐璐动画 · Q 版萌系 · 橡皮管卡通 · 漫画分镜 · 小人书连环画 · 表情包贴纸 · 火柴人 · 黏土定格 · 纸偶动画 |
| 游戏数字 | 8-bit 像素 · 16-bit RPG · 等距视角 · 低多边形 · 体素 · 赛博朋克 HUD · 复古街机 CRT · ASCII 代码雨 · 蒸汽波 |
| 电影年代 | 黑白默片 · 70 年代胶片 · 黑色电影 · 90 年代港片霓虹 · 西部宽银幕 · 老新闻片 · 武侠片 · 科幻片头 · 公路片 |
| 材质 3D | 玻璃折射 · 液态金属 · 毛毡 · 折纸 · 粒子 · 流体 · 光线行进抽象 · 晶体宝石 · 积木 |
| 信息叙事 | 数据可视化 · 产品发布 · 科普讲解 · 地图路线 · 时间线 · 白板讲解 · **发布会 Keynote** · 纪录片字幕 · 竖屏短视频 |
<!-- /gallery -->

想看每种风格适合拍什么，可以说「用 wukong-animation 查看动画风格，推荐适合古诗的画风」；Claude Code 也可输入 `/wukong-animation:styles 古诗`。

库里没有你想要的风格？直接跟助手说"帮我新建一个风格"，它会引导你做一个属于自己的风格，以后可以反复使用。

## 常用命令

下表是 Claude Code 命令。Codex / ChatGPT 桌面端直接描述相同需求，分别使用插件的 `film`、`styles`、`setup` 技能。

| 命令 | 作用 |
|---|---|
| `/wukong-animation:film [故事]` | 开拍一支新片，或继续在制的片子 |
| `/wukong-animation:styles [关键词]` | 查看所有风格，或按关键词推荐 |
| `/wukong-animation:setup` | 安装 / 检查运行环境 |

## 常见问题

**需要会写代码吗？**
不需要。代码由助手来写，你只负责讲故事和提意见。

**会用到 AI 视频生成吗？**
不会。所有画面都是代码一帧一帧绘制的，所以同一份工程每次渲染出来的结果完全一样，改一个镜头也只需要重新渲染那一个镜头。

**修改一镜也要整片重渲吗？**
日常先看静帧或局部小样，完整预览和终稿在你明确要求时生成。小样最多 960 长边、15fps，默认低并发；终稿保持原定画质。未改镜头和已验证的相同片段会复用，每镜保留最新小样与高清缓存。需要空间时告诉助手清理：`wka status` 列出各目录占用，`wka clean --deep` 先列清单、确认后才删可再生内容；不要自行删除整个 `.cache` 或 `.wka`。

**字体下载失败怎么办？**
字体会自动从 GitHub 或 jsDelivr 下载。如果两个都连不上，可以设置环境变量 `WKA_FONT_MIRROR`，指向一个与 [google/fonts](https://github.com/google/fonts) 目录结构相同的镜像地址。

**想要竖屏视频？**
在开拍时告诉 Claude "做成竖屏（9:16）"即可。

**做出来的片子版权归谁？**
归你。

## 许可

- 代码与文档：MIT
- 示范片、风格帧：CC BY 4.0（见 `LICENSE-MEDIA`）
- 你用 wukong-animation 做的片子归你所有
- 发布会 Keynote 等用 remotion 管线渲染的风格依赖 [Remotion](https://www.remotion.dev/license)：个人和不超过 3 人的公司免费，更大的公司需要向 Remotion 购买公司授权

## 开发者与贡献者

想了解实现原理或参与贡献：

- 架构说明：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 完整制作流程（9 道工序）：[plugin/skills/director/SKILL.md](plugin/skills/director/SKILL.md)
- 贡献新风格：[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
