#!/usr/bin/env node
// 新建管线（等同于 new-kit.mjs <名称> --pipeline）。新建后引擎会自动注册，不用改任何核心代码。
// 用法：node tools/new-kit.mjs <名称> [--desc 描述]
//       node tools/new-kit.mjs <名称> --pipeline [--desc 描述]
//       node tools/new-kit.mjs <名称> --exporter --ext mp4 [--desc 描述]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyTemplate, NAME_RE } from '../plugin/engine/core/scaffold.mjs';
import { parseArgs } from '../plugin/engine/bin/args.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { pos, opt } = parseArgs([path.basename(process.argv[1]), ...process.argv.slice(2)]);
const name = pos[0];
if (!name || !NAME_RE.test(name)) {
  console.error('用法：node tools/new-kit.mjs <名称> [--pipeline | --exporter --ext <扩展名>] [--desc 描述]');
  process.exit(1);
}
const kind = opt('pipeline', !opt('exporter')) ? 'pipelines' : opt('exporter') ? 'exporters' : 'kits';
const dest = path.join(ROOT, 'plugin/engine', kind, name);
copyTemplate(path.join(ROOT, 'plugin/engine', kind, '_template'), dest, {
  NAME: name,
  DESCRIPTION: opt('desc', '（描述）'),
  GLOBAL: name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()),
  EXT: opt('ext', 'bin'),
});
console.log(`✓ 已创建 ${path.relative(ROOT, dest)} —— 引擎会自动注册（wka list ${kind}）`);
