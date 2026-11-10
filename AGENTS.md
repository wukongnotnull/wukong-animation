# wukong-animation 协作规则

本文件同时供 Codex 与 Claude Code 使用。`CLAUDE.md` 指向这里，两处规则保持同一份。

## 项目

wukong-animation 用代码逐帧制作动画，不调用视频生成模型，也没有生成费用。不要询问模型、数量、时长、费用或预算。

制作流程以 [plugin/skills/director/SKILL.md](plugin/skills/director/SKILL.md) 为准。插件源码在本仓库；已安装的插件缓存只读，不在缓存里改代码。

`films/` 被本仓库忽略。每支影片是独立 Git 仓库，影片签批只提交该影片仓库中的对应文件。

## 版本与记录

- 修改版本号前，先说明建议版本，得到明确允许后再改。
- 新建或修订 spec 默认通过，写完后直接实施。此授权只针对 spec，不包含版本号、发布和推送。
- 继续维护 GitHub issue 与 PR，不同步 GitHub Projects 看板。
- 对话里不全文贴剧本、分镜或长交付文稿，只给文件链接、短说明和待审事项。

## 开发

在仓库根目录运行，使用 Node.js 20 或更高版本：

- `npm test`：单元与集成测试
- `npm run lint`：清单、文档与架构检查
- `npm run smoke`：冒烟渲染
- `npm run test:jianying`：剪映必跑集合

只运行与本次改动直接相关的检查。

## 收尾

核对改动并完成必要验证后，为本次改动建立 commit，保留无关的未提交文件。任务结束时检查分支和 Git worktree：已合并且闲置的删除；正在使用、有独立提交或未提交工作的保留，并说明原因。
