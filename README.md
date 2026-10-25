# wukong-animation · 代码七十二变

> 72 种动画风格，每种一个 skill。Claude 写代码，一帧一帧"画"出短片 —— 不用任何视频生成模型。

<!-- progress -->
**已修成 1 / 72 变**
<!-- /progress -->

## 安装

在 Claude Code 里：

```
/plugin marketplace add wukongnotnull/wukong-animation
/plugin install wukong-animation@wukong-animation
/wukong-animation:setup
```

`setup` 会把 Chromium 和 npm 依赖装到 `~/.wukong-animation/deps/`（插件升级不会丢）。另外需要：

| 依赖 | 必需 | 用途 |
|---|---|---|
| Node ≥ 20 | ✓ | 引擎 |
| ffmpeg | ✓ | 编码、混音 |
| git | 推荐 | 每个审片节点自动定版存档，随时回滚 |
| `pip install fonttools brotli` | 推荐 | 中文字体子集化 |

字体按需下载：先试 GitHub，再试 jsDelivr。两处都连不上时，设置 `WKA_FONT_MIRROR` 指向一个与 [google/fonts](https://github.com/google/fonts) 同结构的镜像根地址，会最先尝试它。
| edge-tts / kokoro | 可选 | AI 配音（VO） |

## 用法

```
/wukong-animation:film 一个关于秋天离别的水墨短片，20 秒
```

导演（`director` skill）会带你走完 12 道工序，在 8 个审片节点停下来等你签批：

| # | 工序 | 审片节点 |
|---|---|---|
| 1 | 制作环境 · 工程初始化 · 恢复在制项目 | |
| 2 | 制作简报 | |
| 3 | 美术定调 | ① 美术定调 |
| 4 | 文学脚本撰写 | ② 文学脚本 |
| 5 | 分镜脚本 | ③ 分镜 |
| 6 | VO 素材来源 | ④ VO 素材来源 |
| 7 | 声轨制作 | ⑤ 声轨审听 |
| 8 | 风格帧与动态分镜 | ⑥ 风格帧与动态分镜 |
| 9 | 镜头制作 | |
| 10 | 小样渲染与技术质检（量化检测 + 目视审片） | ⑦ 小样 |
| 11 | 终版渲染与终混 | |
| 12 | 终检与交付 | ⑧ 终审 |

其他命令：`/wukong-animation:styles`（看 72 变）、`/wukong-animation:setup`。

## 72 变

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
| 信息叙事 | 数据可视化 · 产品发布 · 科普讲解 · 地图路线 · 时间线 · 白板讲解 · 发布会 Keynote · 纪录片字幕 · 竖屏短视频 |
<!-- /gallery -->

## 它是怎么工作的

```
plugin/
├── skills/
│   ├── director/        总导演：12 步流程（所有风格共用）
│   ├── new-style/       自定义风格向导
│   └── ink-wash/ …      每种风格一个 skill：STYLE.md 美学 · TECH.md 技术 · style.json 声明 · scripts 积木
├── commands/            /wukong-animation:film · styles · setup
└── engine/              渲染引擎
    ├── core/            注册表 · 解析 · 任务 · 缓存 · 字体 · QA · 进度
    ├── runtime/         页面运行时：帧时钟 · 种子随机 · 噪声 · 缓动 · 时间轴
    ├── pipelines/       插槽① 出片管线：browser（可用）· manim · remotion（规划中）
    ├── kits/            插槽② 工具包：canvas2d · webgl（可用）· pixel · three · svg-gsap · d3 · film-post（规划中）
    └── exporters/       插槽③ 导出：mp4 · gif · png-seq
```

- **风格只管"画成什么样"**，制作管线只在 director 里，72 个风格共用一套。
- **插槽式扩展**：新增一条管线 / 一个工具包 / 一种导出格式 = 新建一个目录，引擎自动注册，核心代码不用改。
- **确定性**：镜头的 `render(ctx, t, s)` 是 t 的纯函数，随机数全部带种子 —— 同一份源码永远渲染出同一部片，可以按镜头缓存、并行、只重渲改动的那一镜。
- **声画同步**：声音先行，VO 先录制或合成，实测入出点写成"声音同步点"，画面按同步点对位。
- **量化质检（QC）**：`wka qc` 逐帧量留白、点缀色、帧差、硬切，阈值写在每个风格的 `style.json` 里。

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；制作流程见 [docs/workflow/v1.0.0.md](docs/workflow/v1.0.0.md)（当前 v1.0.0）。想贡献新风格，看 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)。

## 许可

- 代码与文档：MIT
- 示范片、风格帧：CC BY 4.0（见 `LICENSE-MEDIA`）
- 你用 wukong-animation 做的片子归你所有

---

**English** — wukong-animation is a Claude Code plugin with a library of animation styles (72 planned, 1 shipped: Chinese ink wash). Claude directs a short film from your story and renders every frame with code — Canvas 2D, WebGL and ffmpeg — no video model involved. Install with `/plugin marketplace add wukongnotnull/wukong-animation`, then run `/wukong-animation:setup` and `/wukong-animation:film <your story>`.
