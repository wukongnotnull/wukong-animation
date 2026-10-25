#!/usr/bin/env node
// 从工具包源码的 JSDoc 生成 README.md —— 模型靠这份 README 学会调用工具包，
// 所以它必须和代码一致：改了代码就重跑一次（CI 会检查）。
// 用法：node tools/build-docs.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KITS = path.join(ROOT, 'plugin/engine/kits');
const check = process.argv.includes('--check');
let stale = 0;

/** 读取以 { 开头、括号配平的类型表达式。 */
function takeType(str) {
  str = str.trim();
  if (!str.startsWith('{')) return null;
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}' && --depth === 0) return { type: str.slice(1, i), rest: str.slice(i + 1).trim() };
  }
  return null;
}

function parse(src) {
  const header = (src.match(/^\/\*([\s\S]*?)\*\//) || [, ''])[1]
    .split('\n')
    .map((l) => l.replace(/^\s*\* ?/, ''))
    .join('\n')
    .trim();
  const items = [];
  const re = /\/\*\*([\s\S]*?)\*\/\s*\n\s*([\w.]+)\s*=\s*function\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(src))) {
    const lines = m[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '').trimEnd());
    const desc = [];
    const params = [];
    let ret = '';
    for (const l of lines) {
      if (l.startsWith('@param')) {
        // 一行里可能写多个 @param（如 "@param {number} o.x0  @param {number} o.x1  说明"）
        for (const part of l.split(/(?=@param\s)/)) {
          const t = takeType(part.replace(/^@param\s+/, ''));
          if (!t) continue;
          const m2 = t.rest.match(/^(\[[^\]]*\]|[\w.]+)\s*(.*)$/);
          if (m2) params.push({ type: t.type, name: m2[1], text: m2[2] });
        }
      } else if (l.startsWith('@return')) {
        const t = takeType(l.replace(/^@returns?\s+/, ''));
        if (t) ret = `\`${t.type}\` ${t.rest}`.trim();
      } else if (l.trim() && !l.startsWith('@')) desc.push(l.trim());
    }
    items.push({ name: m[2], args: m[3].trim(), desc: desc.join(' '), params, ret });
  }
  return { header, items };
}

for (const d of fs.readdirSync(KITS, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name.startsWith('_')) continue;
  const dir = path.join(KITS, d.name);
  const kit = JSON.parse(fs.readFileSync(path.join(dir, 'kit.json'), 'utf8'));
  if (kit.status === 'planned') continue;
  const { header, items } = parse(fs.readFileSync(path.join(dir, kit.entry), 'utf8'));
  const md = [
    `# ${kit.name} 工具包 · v${kit.version}`,
    '',
    `> 本文件由 \`tools/build-docs.mjs\` 从 \`${kit.entry}\` 的 JSDoc 生成，请勿手改。`,
    '',
    kit.description,
    '',
    '```',
    header,
    '```',
    '',
    `依赖工具包：${Object.keys(kit.kits || {}).join('、') || '无'} · 第三方库：${(kit.libs || []).join('、') || '无'}`,
    '',
    '## API',
    '',
  ];
  for (const it of items) {
    md.push(`### \`${it.name}(${it.args})\``, '', it.desc, '');
    if (it.params.length) {
      md.push('| 参数 | 类型 | 说明 |', '|---|---|---|');
      for (const p of it.params) md.push(`| \`${p.name}\` | \`${p.type.replace(/\|/g, '\\|')}\` | ${p.text.replace(/\|/g, '\\|')} |`);
      md.push('');
    }
    if (it.ret) md.push(`返回：${it.ret}`, '');
  }
  const text = md.join('\n').replace(/\n{3,}/g, '\n\n');
  const out = path.join(dir, 'README.md');
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) {
      console.error(`${path.relative(ROOT, out)} 不是最新的`);
      stale++;
    }
  } else {
    fs.writeFileSync(out, text);
    console.log(`✓ ${path.relative(ROOT, out)}（${items.length} 个函数）`);
  }
}
if (stale) {
  console.error('运行 node tools/build-docs.mjs 重新生成');
  process.exit(1);
}
