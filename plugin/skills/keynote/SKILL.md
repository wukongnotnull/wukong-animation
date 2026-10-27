---
name: keynote
description: 发布会 Keynote 风格动画（wukong-animation 第 70 变）：深色透视网格底、单一 Claude 橙强调色、Inter + 思源黑体大字排版、L01–L07 版式、代码重绘的产品界面、镜头推近与高亮框、对象级神奇移动。用户要产品发布、功能讲解、知识讲解、口播类信息片、科技感图文动画时使用；走 remotion 管线（React 组件写镜头）。
---

# 发布会 Keynote · keynote

这是一个**风格** skill：只规定"画成什么样、用什么技术画"。
**拍片流程请按 `director` skill 执行**（本目录上一级的 `director/SKILL.md`）。

## 开工前必读

1. `STYLE.md` —— 美学规范、禁忌清单、交付前质检。是硬约束。
2. `TECH.md` —— 镜头写法（`.tsx`）与积木 API（`@wka/style`）。

## 技术声明（style.json）

- 管线：`remotion`（React 组件，每镜一个 Composition；实验性）
- 工具包：无；风格积木在 `scripts/`（`index.ts` 汇总导出），镜头里 `import { … } from '@wka/style'`
- 镜头文件：`shots/sNN.tsx`（`wka init --style keynote` 会生成 `s01.tsx`）
- 字体：Inter / Noto Sans SC / JetBrains Mono（按需下载，OFL）
- QA 阈值：深色底 ≥ 60%，橙色 ≤ 4%，相邻帧差 ≤ 20，硬切 ≤ 2

## 许可提醒

Remotion **个人和不超过 3 人的公司免费，更大的公司需要购买公司授权**（<https://www.remotion.dev/license>）。用这个风格前请确认符合条件。

## 常见问题

- **截图 / 界面四周露白边**：`Shot` 的自然尺寸和图位比例不一致时会留边；把自然尺寸改成与图位同比例，或给 `Shot` 传 `style={{ background: color.container }}`。
- **续镜闪一下**：前镜 `exit="hold"`、后镜 `enter="hold"`，后镜第 0 帧要与前镜最后一帧完全相同（镜头位置、推进量、叠加层都要接上）；逐帧比对接缝两帧。
- **改一句人声，全片都重渲**：镜头里只用字面量 `s.cueIn('名')`，不要 `s.cueIn(变量)`，也不要直接读 `s.cues`。
- **标题折行**：竖屏超过约 8 个汉字的标题给 `portrait` 断行；横屏标题宽度别超过 1440（右上留给出镜小窗）。
