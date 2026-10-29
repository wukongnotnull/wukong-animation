# 制作流程修订记录

> 给插件维护者看，导演做片时不用读。当前流程以 `../SKILL.md` 为准。

## 怎么改流程

- 流程变更（新增 / 调整工序与审片节点、改提交方式等）由项目负责人（插件维护者）决定。用户在审片时是客户，改流程时是项目负责人，可以是同一个人。
- 改 `SKILL.md` 里的流程时，升 SKILL.md 开头的流程版本号，并在下面「修订记录」最上面记一条：版本号、日期、改了什么、关联 issue。
- 只改写法、不改流程的，不升版本号。

## 修订记录

- v1.14.0（2026-10-29）：通用宿主按实际工具能力交付：先读 `HOSTS.md`；没有文件链接或预览时用 `delivery --host generic` 给出真实路径、类型和未验证说明，不编造可点击目标。Codex / Claude 的原有链接格式不变。15 道工序与 12 个审片节点不变（[#98](https://github.com/wukongnotnull/wukong-animation/issues/98)、[#99](https://github.com/wukongnotnull/wukong-animation/pull/99)）。

- v1.13.0（2026-10-29）：长片审片与交付可靠性优化：关键词同步区分实际来源和估算，字幕预检保留人工断句与双语稿；主版成功证明按当前输入/定稿/环境复用；恢复先核实阶段和产物，同一批准重试不重复存档，已确认的简报交付选择不再询问；声轨分段审听、QC 人工处置和草稿声音差异在交付前明确。15 道工序与 12 个审片节点不变（[#93](https://github.com/wukongnotnull/wukong-animation/issues/93)、[#94](https://github.com/wukongnotnull/wukong-animation/pull/94)、[#95](https://github.com/wukongnotnull/wukong-animation/pull/95)、[#96](https://github.com/wukongnotnull/wukong-animation/pull/96)）。

- v1.12.0（2026-10-29）：适配 Codex / ChatGPT 桌面本地执行环境：从加载的 skill 解析插件路径，按宿主能力选择提问工具与文件链接；异步提问必须等待明确回复，无多选工具时使用多轮单选或文字收集返修意见。15 道工序与 12 个审片节点不变。

- v1.11.0（2026-10-28）：新增第 14 道工序「改版」与审片节点 ⑪ 改版审片：简报可定「主画幅 + 副版」，主版终审后用同一套镜头和声轨排出副版画幅（`film.json` 的 `variants`、命令加 `--aspect`），随副版提交主版不变报告；原第 14 道剪映草稿顺延为第 15 道、节点 ⑪ 顺延为 ⑫，流程变为 15 道工序 · 12 个审片节点；返修流程增加「改版返修」；分镜规范增加「副版重排」表（[#89](https://github.com/wukongnotnull/wukong-animation/issues/89)）
- v1.10.0（2026-10-28）：用户带来现成口播稿时，第 2 道把原文存为片目录的 `口播稿.md`，故事 / 主题、片长、人声从稿子推出；第 4 道以它为素材写剧本，人声文案用原句，画不出来的句子写成改稿建议 `review/改稿建议.md` 随剧本提交，用户同意的才改；工序与审片节点不变（[#87](https://github.com/wukongnotnull/wukong-animation/issues/87)）
- v1.9.0（2026-10-28）：流程文档 `docs/PRODUCTION-WORKFLOW.md` 并入 `director/SKILL.md`，术语表移到 `references/GLOSSARY.md`，修订记录与未采纳的提案移到本文件；工序与审片节点不变（[#75](https://github.com/wukongnotnull/wukong-animation/issues/75)）
- v1.9.0（2026-10-28）：分镜表栏目改为按观看顺序排、画面与声音分组：镜 · 段落 · 时长 · 转场 · 景别 · 画面 · 运镜 / 动态 · 屏幕文字 · 人声 · 音效（原来转场在最后、屏幕文字夹在音效和转场之间）；`film.json` 字段说明从 `STORYBOARD.md` 拆到 `plugin/skills/director/FILM.md`（[#68](https://github.com/wukongnotnull/wukong-animation/issues/68)）
- v1.8.1（2026-10-27）：第 6 道试听选音色也按「试听文件可点击路径 → 推荐理由 → 选音色卡片」三步提交；凡请客户看、听文件处都必须先列可点击路径，不能只说「已生成、可播放」
- v1.8.0（2026-10-27）：审片节点三步提交的第 1 步改为签批卡片前逐个列出要签批的文件，每个一行可点击的 Markdown 链接（文字为绝对路径、地址为相对当前工作目录的路径），客户点击即可观看；第 6 道试听、第 7 道声轨、第 10 道小样、第 13 道成片同此格式（[#37](https://github.com/wukongnotnull/wukong-animation/issues/37)）
- v1.7.0（2026-10-27）：第 2 道制作简报改为追问式确认，不再用选择卡片；片名定下即 `wka brief <片名>` 建占位片目录，追问达成共识后写 `brief.md`，新增审片节点 ① 制作简报，原节点 ①–⑩ 顺延为 ②–⑪，流程变为 14 道工序 · 11 个审片节点；「简报复核」移出待议变更（[#34](https://github.com/wukongnotnull/wukong-animation/issues/34)）
- v1.6.0（2026-10-27）：景别写进 `film.json` 的 `shots[].size`，第 5 道签批时引擎检查（每镜都写、4 镜及以上至少 3 种、相邻不同），不合规拒绝签批；人声可设 `chars: true`，`wka soundtrack` 写出逐字同步点，题字逐字对位改用 `s.cueChars`；ffmpeg 不带 drawtext 时接触表和动态分镜改由 Chromium 画镜号；剪映字体对照改成单独的对照表，lint 检查每个风格的字幕字体都有对照（[#24](https://github.com/wukongnotnull/wukong-animation/issues/24)）
- v1.5.2（2026-10-27）：交给客户审的文件都放进 `review/`——动态分镜 `review/动态分镜.mp4`、接触表 `review/接触表.jpg`、字幕预览 `review/字幕预览.mp4`（[#28](https://github.com/wukongnotnull/wukong-animation/issues/28)）
- v1.5.1（2026-10-27）：第 14 道剪映草稿——导出前请客户完全退出剪映，引擎检测到剪映在运行会拒绝导出；剪映里已有同名草稿时自动导出为 `<片名>_v2`、`_v3`……旧草稿不动，不再要求客户先删掉或改名旧草稿（[#24](https://github.com/wukongnotnull/wukong-animation/issues/24)）
- v1.5.0（2026-10-27）：按《春晓》试拍结果补规则——全程用客户的语言说话；第 6 道选 AI 配音后先用 `wka audition` 试听 2–3 个音色再签批，可调语速、音高（`voices[].rate` / `pitch`），内置音色不够时从外部拿音频按自供录音接入；第 7 道声轨不要求镜头文件已写好；第 14 道字幕样式由导出器写入，不再跑片目录里的样式补丁（[#25](https://github.com/wukongnotnull/wukong-animation/issues/25)）
- v1.4.0（2026-10-26）：按《一叶知秋》试拍结果补规则——审片节点固定按「交付物绝对路径 → 一两句说明 → 签批卡片」提交；声轨、小样交 `review/` 下能直接播放的副本；分镜至少 3 种景别、相邻两镜景别不同；风格帧每镜至少两个层次；屏幕文字跟着人声逐字对位；字幕要搭风格、在安全框内，样式写 `film.json` 的 `subtitles.style`；成片文件名标明有没有字幕，`both` 同时出无字幕版；第 14 道不管简报怎么选都先问要不要导出剪映草稿（[#22](https://github.com/wukongnotnull/wukong-animation/issues/22)）
- v1.3.1（2026-10-26）：按试拍结果补规则——第 1 道只有必需项缺失才停下；第 2 道人声选择以客户为准，故事里没有的人声由第 4 道补写；第 3 道只用可直接开拍（`available`）的风格出方案，提报前先读候选风格的 `STYLE.md` 禁忌清单（[#19](https://github.com/wukongnotnull/wukong-animation/issues/19)）
- v1.3.0（2026-10-26）：要客户做选择的地方改用选择卡片，文字只做补充——第 1 道恢复或新建、第 2 道制作简报、第 3 道美术定调、第 6 道人声素材来源，以及各审片节点的签批与返修意见；工序和节点不变（[#17](https://github.com/wukongnotnull/wukong-animation/issues/17)）
- v1.2.0（2026-10-26）：新增第 11 道工序「字幕制作」与审片节点 ⑧，原第 11–13 道顺延为第 12–14 道、原节点 ⑧⑨ 顺延为 ⑨⑩，流程变为 14 道工序 · 10 个审片节点；第 2 道制作简报增加「字幕方式」；「字幕工序」移出待议变更（[#15](https://github.com/wukongnotnull/wukong-animation/issues/15)）
- v1.1.0（2026-10-26）：新增第 13 道工序「剪映草稿交付」与审片节点 ⑨，流程变为 13 道工序 · 9 个审片节点；第 2 道制作简报增加「交付形式」，返修流程增加「草稿返修」（[#11](https://github.com/wukongnotnull/wukong-animation/issues/11)）
- （2026-10-26）：第 4 道工序更名为「文学脚本撰写」（原名「脚本撰写」，与配乐脚本、镜头代码等同名易混），细则补充写法要求、示例与自查清单；段落结构允许 20 秒以内的片子合并转、合
- v1.0.0（2026-10-25）：首个正式版本

## 未采纳的提案

以下几项曾作为流程优化提案提出，项目负责人未予采纳，**不在当前流程内**：

| 提案 | 内容 |
|---|---|
| 快速审片通道 | ≤20 秒的短片将多个审片节点合并为一次签批 |
| 多画幅同步交付 | 分镜阶段标注安全框（Safe Area），一次渲染同时输出 16:9 横版与 9:16 竖版 |
| 交付物包 | 自动生成封面图、片尾字幕表 `CREDITS.txt`（人声字幕文件已由第 11 道字幕制作产出） |
| 风格库复盘 | 每部片子交付后，把制作中踩过的坑写回该风格 `SKILL.md` 的"常见问题" |
| 交付规格检查 | 第 13 道终检时核对片长、分辨率、帧率、响度（LUFS）、编码格式是否符合交付要求 |
| 素材授权检查 | 终检时核对用到的字体和素材是否为开源授权、是否模仿了特定作品 |
