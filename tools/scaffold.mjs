// 脚手架公共函数：复制模板目录并替换 __占位符__。
import fs from 'node:fs';
import path from 'node:path';

export function copyTemplate(src, dest, vars) {
  if (fs.existsSync(dest)) throw new Error(`${dest} 已存在`);
  fs.cpSync(src, dest, { recursive: true });
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|json|js|mjs)$/.test(e.name)) {
        let s = fs.readFileSync(p, 'utf8');
        for (const [k, v] of Object.entries(vars)) s = s.split(`__${k}__`).join(String(v));
        fs.writeFileSync(p, s);
      }
    }
  };
  walk(dest);
}

export function args(argv = process.argv.slice(2)) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      opt[k] = v;
    } else pos.push(argv[i]);
  }
  return { pos, opt };
}

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
