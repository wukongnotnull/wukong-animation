// 解析第三方依赖：优先 ~/.wukong-animation/deps/<引擎版本>/node_modules（wka setup 安装的位置），
// 其次引擎目录自身的 node_modules（开发时），最后是全局安装。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DEPS_DIR, ENGINE_ROOT } from './paths.mjs';

const roots = [path.join(DEPS_DIR, 'package.json'), path.join(ENGINE_ROOT, 'package.json')];

export function requireDep(name) {
  for (const r of roots) {
    if (!fs.existsSync(path.dirname(r))) continue;
    try {
      return createRequire(r)(name);
    } catch {
      /* 试下一个位置 */
    }
  }
  return createRequire(import.meta.url)(name);
}

export function hasDep(name) {
  try {
    requireDep(name);
    return true;
  } catch {
    return false;
  }
}
