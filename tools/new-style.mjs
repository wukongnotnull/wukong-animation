#!/usr/bin/env node
// 从模板创建新风格。
// 用法：node tools/new-style.mjs <id> --name 名称 --category <分类> [--order N] [--user]
//   --user  建到 ~/.wukong-animation/styles/（自用），否则建到 plugin/skills/（贡献到仓库）
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copyTemplate, args, NAME_RE } from './scaffold.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { pos, opt } = args();
const id = pos[0];
if (!id || !NAME_RE.test(id) || !opt.name || !opt.category) {
  console.error('用法：node tools/new-style.mjs <id> --name 名称 --category dongfang|shouhui|pingmian|katong|youxi|dianying|caizhi|xinxi|custom [--order N] [--user]');
  process.exit(1);
}
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/plan72.json'), 'utf8'));
const planned = plan.styles.findIndex((s) => s[0] === id);
const order = opt.order || (planned >= 0 ? planned + 1 : opt.user ? 101 : plan.styles.length + 1);
const base = opt.user ? path.join(process.env.WUKONG_ANIMATION_HOME || path.join(os.homedir(), '.wukong-animation'), 'styles') : path.join(ROOT, 'plugin/skills');
fs.mkdirSync(base, { recursive: true });
const dest = path.join(base, id);
copyTemplate(path.join(ROOT, 'templates/style-skill'), dest, {
  ID: id,
  NAME: opt.name,
  CATEGORY: opt.user ? 'custom' : opt.category,
  ORDER: order,
  GLOBAL: id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()),
  ONE_LINE: '（一句话特征）',
  WHEN: '（什么样的片子）',
});
console.log(`✓ 已创建 ${dest}（第 ${order} 变）`);
console.log('  下一步：写 STYLE.md 十节 → TECH.md → scripts/style.js → examples/ 示范片 → node tools/build-catalog.mjs');
