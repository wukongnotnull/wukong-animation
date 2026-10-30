# 剪映草稿交付修复实施计划

目标：标准 CLI 可靠交付连续切点、完整双语和尺寸正确的可编辑字幕。

架构：统一时间轴帧切点转为微秒区间；纯草稿执行原生尺寸版式预检，逐条字号和位置交给剪映计划。Python 按片段、轨道、全局顺序选择样式；实际宿主校准与自动检查分开记录。

技术栈：Node.js ESM / node:test、Playwright Chromium、ffmpeg、Python / pyJianYingDraft 0.3.1、剪映 11.6.0。

依据：[已批准 spec](../specs/2026-10-30-1230-jianying-delivery-design.md)。

## 全局约束（摘自 spec）

- 不修改客户 `film.json`、字幕、已签批镜头或已有剪映草稿；真实工程仅作为只读时间/文本诊断样本。校准与集成导出使用隔离测试目录和新的草稿名。
- 保留剪映运行时拒绝写入、素材复制、同名避让、用户编辑保护、完成回执和阶段恢复。不得通过 `--force` 自动覆盖用户决定。
- 修改发生于拥有源码的仓库，不修改插件安装缓存。保持公共 CLI 用法和现有作品配置兼容。
- 不升级 pyJianYingDraft，不扩大剪映支持版本承诺，不自动发布。

## 文件与职责

- `plugin/engine/exporters/jianying/plan.mjs`：帧切点量化、逐条字幕字号/位置映射。
- `plugin/engine/exporters/jianying/write_draft.py`：逐条样式优先及素材长度检查。
- `plugin/engine/bin/wka.mjs`：警告分类、纯草稿版式测量、传递当前测量。
- `plugin/skills/director/SKILL.md` 与自动生成的 portable 文档：实际显示检查要求。
- `tests/unit/jianying-plan.test.mjs`：时间量化、输入拒绝和逐条样式。
- `tests/integration/jianying.test.mjs`：真实 Python 写入、英文与旧保护行为。
- `tests/integration/subtitle-preflight.test.mjs`：现有来源失效、版式拒绝回归。
- `docs/wukong-code-project/reports/`：实际校准与最终验证证据。

## 1. 时间量化与素材长度（A1/A2）

先增加三镜 2/30 秒、107 镜及真实非法输入的单测；运行 `node --test tests/unit/jianying-plan.test.mjs` 确认旧实现因重叠/缺检查失败。最小实现使用统一帧起止换算，拒绝实质非法输入；Python 不静默裁短不足素材。补真实写入验证后运行同命令与 jianying 集成测试，确认通过，单独提交。

## 2. 英文分类与当前测量（A3/A4）

增加标准 CLI 超28字符和句号警告的真实导出回归，以及空英文/中文错配拒绝；先运行 `node --test tests/integration/jianying.test.mjs` 确认旧实现失败。复用 `attachEnglish`，保留 `checkEnglish` 警告，纯草稿原生尺寸布局预检，不拼全片；新测量绑定当前输入。运行该测试与 `tests/integration/subtitle-preflight.test.mjs` 确认通过。

## 3. 实际字号和逐条样式（A5/A6）

先以隔离草稿和同字体参考图校准本机剪映映射，再用已记录样本写失败单测，覆盖横竖、两档基础字号及长英文独立缩放。计划接收画布和当前测量，writer 优先片段样式，保留旧计划回退。运行单测、真实 Python 集成，然后实际打开新草稿检查边界/双语间距、同字体高度误差≤10%，保存重开并记录截图。不得用客户旧草稿手调数值替代校准。

## 4. 保护与交付验证（A7）

运行 `npm test`、`npm run lint`、`npm run smoke`，以及107镜×横竖标准CLI隔离导出，逐段核对实际草稿区间。检查旧稿修改保护、复用、运行阻塞和失败清理；修复失败后重跑受影响检查。更新报告与 #93，分别记录自动结果、实际宿主结果、未验证边界，提交源码，不自动发布。
