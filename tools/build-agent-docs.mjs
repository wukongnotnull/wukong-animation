#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfiles } from './install-agent.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const agents=loadProfiles().agents;
const text=`# Agent 安装指南

本指南对应当前源码分支；新增 portable 安装包尚未随正式 Release 发布。源码可先运行 \`npm run build:portable\` 生成 dist，或从本 PR 的 CI artifacts 获取构建包。已有 Claude/Codex/ChatGPT 原生插件继续使用 README 原生安装方式。

## 安装与开始制作

需要 Node.js 20+。下载对应版本的 \`wukong-animation-agent-skills-v<版本>.zip\` 与 SHA256SUMS，核对校验和后用系统解压工具解压；进入包含 install-agent.mjs 的目录。以下命令不自动安装 Agent 客户端或渲染依赖：

\`\`\`text
node install-agent.mjs list
node install-agent.mjs install --agent cursor --scope project --project "<已存在的项目绝对路径>" --dry-run
node install-agent.mjs install --agent cursor --scope project --project "<已存在的项目绝对路径>"
node install-agent.mjs status --agent cursor --scope project --project "<已存在的项目绝对路径>"
\`\`\`

将 cursor 替换为下表 ID；用户级安装改为 \`--scope global\` 并去掉 --project。不确定写哪里时先 --dry-run；自动化加 --json 输出单个 JSON 结果，不混入日志。源码命令使用 \`node tools/install-agent.mjs\` 并追加 \`--bundle "<仓库绝对路径>/dist/wukong-animation"\`。

安装后按客户端的刷新/启用技能方法加载。发消息“使用 wukong-animation 检查环境”，检查通过后再说“使用 wukong-animation 列风格”或“使用 wukong-animation 开始制作一支短片”。工程写入用户选定目录。没有终端/文件权限时可准备简报，但不能执行制作。审片批准继续保留；已有草稿等选择不重复问。

## 工具与作用域

表中的 portable 路径均追加 /wukong-animation；不同客户端/版本可能需要启用技能。minimumVersion 尚未确认数字下限，需使用支持 Agent Skills 的版本。下表是目录安装契约，实际发现、渲染和媒体打开结果见[验证记录](wukong-code-project/reports/2026-10-29-agent-installation-validation.md)，不能把该表当作全功能实测。

| ID | 工具族 | 项目目录 | 用户目录 | 状态 |
| --- | --- | --- | --- | --- |
${agents.map(a=>`| ${a.familyId} | ${a.label} | ${a.projectPath||'原生插件'} | ${a.globalPath||'原生插件'} | ${a.qualification==='candidate'?'候选，禁止写入':a.channel==='native'?'保留原生渠道':'目录契约适配'} |`).join('\n')}

具备 variants 的工具必须显式选择：cascade 使用 \`--variant devin\` 或 \`--variant windsurf\`；antigravity 使用 \`--variant ide\` 或 \`--variant cli\`；trae/qoder 使用 \`--variant international\` 或 \`--variant cn\`。目录如下，其他字段与主配置一致：

| ID / variant | 项目目录 | 用户目录 |
| --- | --- | --- |
${agents.flatMap(a=>Object.entries(a.variants).map(([id,v])=>`| ${a.familyId} / ${id} | ${v.projectPath||a.projectPath} | ${v.globalPath||a.globalPath} |`)).join('\n')}

Kiro CLI 默认 Agent 自动加载目录；自定义 Agent 需手动在资源声明中添加 \`skill://.kiro/skills/**/SKILL.md\`，安装器不会改已有配置。Kiro IDE 可导入包内 wukong-animation 子目录，单独核验。Cline 尚缺具体加载路径佐证，暂不启用。ChatGPT 普通网页聊天不等于桌面本地执行环境。

## 更新与卸载

先下载新版本发布包并解压，从新包目录执行同一命令的 upgrade；使用相同 agent/scope/project/variant。不会自动抓浮动 latest，不自动降级；同版本不同内容会拒绝覆盖。

\`\`\`text
node install-agent.mjs upgrade --agent cursor --scope project --project "<项目绝对路径>" --dry-run
node install-agent.mjs upgrade --agent cursor --scope project --project "<项目绝对路径>"
node install-agent.mjs uninstall --agent cursor --scope project --project "<项目绝对路径>" --dry-run
node install-agent.mjs uninstall --agent cursor --scope project --project "<项目绝对路径>"
\`\`\`

用户新增/修改/删除包内文件或同名外部技能时，升级卸载会停止，先自行备份与迁移后重试；没有强制覆盖开关。多个宿主共享一个物理目录时，卸载一个 owner 保留其余 owner，最后一个才删除。作品、其他技能及共享依赖缓存保留。自定义风格默认保存在用户资源目录，适合跨版本使用。

安装后同时有原生插件与 portable 入口时，核对两个版本并在宿主设置中手动停用重复项；安装器不修改宿主配置。找不到入口时先 status 核对作用域与目录，再按客户端文档刷新/启用，不要将同一包盲目复制到多个目录。中断事务可在重试时恢复；遇到用户改动或未知备份会保留文件并报错。

## 依据与限制

目录依据固定到 [skills 适配器源码 92a9a34](https://github.com/vercel-labs/skills/blob/92a9a34ac3bf88e695e468b90c7bf32f163d32c8/docs/agents.md)，Cascade 的当前目录补充[官方文档](https://docs.devin.ai/desktop/cascade/skills)。[调查报告](wukong-code-project/reports/2026-10-29-agent-installation-coverage.md)列出其他官方资料。

只有合同测试通过的具名 family 才计安装适配数；地区版和 IDE/CLI 不重复计数。远程/云端不继承本地资源或预览能力，应在其实际工作区安装检查。第三方安装器只有通过完整目录复制测试后才可作为渠道，本指南不承诺 npx skills add 本仓库已可用。
`;
const target=path.join(root,'docs/agent-installation.md');
if(process.argv.includes('--check')){if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==text){console.error('Agent 安装文档不是最新，请运行 node tools/build-agent-docs.mjs');process.exitCode=1;}}
else fs.writeFileSync(target,text);
