#!/usr/bin/env node
// 维护者：在仓库里新建内置风格（按 plan72.json 取规划序号，再调用 wka new style）。
// 用法：node tools/new-style.mjs <id> --name 名称 --category <分类> [--order N] [--dest 目录]
//   --dest 默认 plugin/skills/；用户自建风格请直接用 wka new style。
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../plugin/engine/bin/args.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { pos, opt } = parseArgs(['new-style', ...process.argv.slice(2)]);
const id = pos[0];
if (!id || !opt('name') || !opt('category')) {
  console.error('用法：node tools/new-style.mjs <id> --name 名称 --category dongfang|shouhui|pingmian|katong|youxi|dianying|caizhi|xinxi [--order N] [--dest 目录]');
  process.exit(1);
}
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/plan72.json'), 'utf8'));
const planned = plan.styles.findIndex((s) => s[0] === id);
const order = opt('order') || (planned >= 0 ? planned + 1 : plan.styles.length + 1);
const wka = path.join(ROOT, 'plugin/engine/bin/wka.mjs');
const r = spawnSync(
  process.execPath,
  [wka, 'new', 'style', id, '--name', opt('name'), '--category', opt('category'), '--order', String(order), '--dest', opt('dest', path.join(ROOT, 'plugin/skills'))],
  { stdio: 'inherit' }
);
if (r.status === 0) console.log('  内置风格还要：node tools/build-catalog.mjs → node tools/render-stills.mjs <id> → node tests/smoke/run.mjs <id>');
process.exit(r.status ?? 1);
