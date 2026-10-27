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

/** 依赖包的根目录（与 requireDep 同样的查找顺序）。打包器要靠它把 react 等钉成同一份。 */
export function resolveDep(name) {
  for (const r of roots) {
    if (!fs.existsSync(path.dirname(r))) continue;
    try {
      return packageRoot(createRequire(r).resolve(name), name);
    } catch {
      /* 试下一个位置 */
    }
  }
  return packageRoot(createRequire(import.meta.url).resolve(name), name);
}

/** 从入口文件往上找到 node_modules/<name> 这一级。 */
function packageRoot(entry, name) {
  const marker = path.join('node_modules', ...name.split('/'));
  const i = entry.lastIndexOf(marker + path.sep);
  return i < 0 ? path.dirname(entry) : entry.slice(0, i + marker.length);
}
