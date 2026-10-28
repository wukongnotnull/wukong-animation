// 脚手架：复制模板目录并替换 __占位符__（wka new style 与 tools/new-* 共用）。
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

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
