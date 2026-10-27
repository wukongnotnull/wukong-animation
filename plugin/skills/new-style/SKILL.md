---
name: new-style
description: 为 wukong-animation 创建自定义动画风格（第 73 变及以后）。用户想要库里没有的风格、想把某种画风做成可复用的风格、或说"新建风格""我自己的风格"时使用。
---

# 新建风格

产出一个和内置风格结构完全相同的目录，存到用户目录 `~/.wukong-animation/styles/<id>/`
（升级插件不会覆盖；`wka list styles` 会标注 `[用户]`）。
想贡献回插件仓库时，把它移到 `plugin/skills/<id>/` 并提 PR。

## 步骤

1. **问清楚风格**：一句话描述、参考的**通用**技法（不要指定画家或作品）、适合什么片子、主色。
2. **选技术**：对照下表选管线和工具包；能用已有工具包就不新建。

   | 风格特征 | pipeline | kits |
   |---|---|---|
   | 手绘、笔触、纸、剪影 | browser | canvas2d |
   | 逐像素效果：晕染、流体、折射、颗粒 | browser | webgl（常与 canvas2d 组合） |
   | 像素 / 低分辨率 | browser | pixel（规划中） |
   | 真 3D | browser | three（规划中） |
   | 矢量排版、动态字体 | browser | svg-gsap（规划中） |
   | 大量排版、界面重绘、发布会式讲解（React 组件，镜头写 .tsx） | remotion | 无（积木放 scripts/index.ts，见 keynote） |

   用到"规划中"的工具包时，告诉用户需要先实现它（`node tools/new-kit.mjs <名>` 生成骨架）。

3. **建目录**（从插件的 `templates/style-skill/` 复制，或手写）：
   ```
   ~/.wukong-animation/styles/<id>/
   ├── SKILL.md      # 触发描述一句话 + "流程按 director 执行"
   ├── STYLE.md      # 固定 10 节：本质 / 色彩 / 文字 / 构图 / 技法 / 运动语言 / 声音 / 禁忌 / 示范片 / 质检
   ├── TECH.md       # 选型理由 + 积木 API
   ├── style.json    # category 用 "custom"，order 从 101 起
   └── scripts/      # 风格积木，挂到 wk.<短名>
   ```
4. **写 style.json 的 qc 阈值**：留白、点缀色、帧差、硬切——让 `wka qc` 能替你把关。
5. **做一支 10–15 秒的示范片**：按 director 的快速通道走，放进 `examples/`，附按分镜格式写的 `storyboard.md`（景别、转场等只用 STYLE.md 里写过的取值），STYLE.md「9. 示范片」链接它。
6. **校验**：`wka list styles` 能看到且不标"不可用"；示范片 `wka qc` 全部通过。
