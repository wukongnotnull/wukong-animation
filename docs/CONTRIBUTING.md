# 贡献指南

## 新增一种风格

```bash
node tools/new-style.mjs watercolor --name 水彩晕染 --category shouhui
```

`tools/plan72.json` 里已有的 id 会自动沿用规划的序号。然后：

1. **STYLE.md**：九段结构（本质 / 色彩 / 构图 / 技法 / 运动 / 声音 / 禁忌 / 示范片 / 质检），lint 会检查。
2. **style.json**：管线、工具包（带版本范围）、字体、`qc` 阈值。
3. **scripts/**：把最难写的技法做成积木，挂到 `wk.<名>`。镜头只做编排。
4. **TECH.md**：选型理由 + 积木 API。
5. **examples/<片名>/**：10–20 秒示范片，必须 `wka qc` 全部通过。
6. `node tools/build-catalog.mjs` → `node tools/render-stills.mjs <id> --gif` → `node tests/smoke/run.mjs <id>`（首次会写入本机平台的基准图 `tests/smoke/baseline/<darwin|linux>/`）。CI 跑在 Linux 上，缺 linux 基准图会直接失败：在 GitHub Actions 里手动运行 smoke workflow 并勾选 `update`，下载 `smoke-baseline-linux` artifact，放进 `tests/smoke/baseline/linux/` 一起提交。
7. `node tools/lint.mjs` 通过后提 PR。

SKILL.md 的 description 控制在 200 字以内，并写清与相近风格的区别（例如"比工笔更写意"）——72 条描述会常驻上下文。

## 新增工具包 / 管线 / 导出器

```bash
node tools/new-kit.mjs particles --desc "GPU 粒子"
node tools/new-pipeline.mjs blender --desc "Blender 无头渲染"
node tools/new-kit.mjs webm-alpha --exporter --ext webm
```

新目录会被引擎自动注册，**不需要改 core/**。规矩：

1. 至少有两个风格要用，才新建工具包；只有一个风格用的代码留在该风格的 `scripts/`。
2. 工具包每个导出函数都写 JSDoc，`node tools/build-docs.mjs` 生成 README（CI 会检查是否最新）。
3. 只用传入的 seed 产生随机性；函数必须是纯函数或只读缓存。
4. 重依赖（Blender、Manim）设为可选：`check()` 缺依赖时给出安装提示，不影响其他管线。
5. 改了引擎或工具包要跑 `node --test tests/unit/*.test.mjs tests/integration/*.test.mjs` 和 `node tests/smoke/run.mjs`，确认没有把已有风格改坏；确实需要改变画面时用 `--update` 更新基准并在 PR 里说明。

## 版权

- 只使用 SIL OFL 等可商用开源字体（登记在 `engine/core/fonts.mjs` 的 `KNOWN_FONTS`，值写它在 google/fonts 仓库里的路径，如 `ofl/mashanzheng/MaShanZheng-Regular.ttf`；下载会自动走 GitHub → jsDelivr）。
- 声音用 `engine/audio/synth.mjs` 合成，或使用明确可商用的素材并在示范片目录写明来源。
- 风格用通用技法描述，不模仿特定画家、工作室或作品的具体画面。
