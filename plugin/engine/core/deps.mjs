// 一次进程只选择一套经锁文件和安装凭据核对的依赖，不逐包回退凑环境。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { HOME, ENGINE_ROOT } from './paths.mjs';
import { dependencyManifest, dependencyDirectory, verifyInstallation } from './dependency-manifest.mjs';

let selected;
export function dependencyInfo() {
  if (!selected) {
    const input = dependencyManifest(ENGINE_ROOT), managed = dependencyDirectory(HOME, input);
    const root = fs.existsSync(managed) ? managed : ENGINE_ROOT;
    verifyInstallation(root, input);
    selected = { root, source: root === managed ? 'managed' : 'development', identity: input.identity };
  }
  return { ...selected };
}

function locate(name) {
  const { root } = dependencyInfo(), req = createRequire(path.join(root, 'package.json'));
  if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name) || name === '.' || name === '..') throw new Error(`依赖名称超出包目录范围：${name}`);
  const entry = fs.realpathSync(req.resolve(name));
  const modules = fs.realpathSync(path.join(root, 'node_modules'));
  const base = path.join(root, 'node_modules', name);
  if (!entry.startsWith(modules + path.sep) || !fs.existsSync(base)) throw new Error(`${name} 的来源不在选定依赖目录 ${modules} 内`);
  const realBase = fs.realpathSync(base);
  if (!realBase.startsWith(modules + path.sep) || !entry.startsWith(realBase + path.sep)) throw new Error(`${name} 的来源超出包目录范围`);
  return { req, entry, base: realBase };
}

export function requireDep(name) {
  const { req, entry } = locate(name);
  return req(entry);
}
export function resolveDep(name) { return locate(name).base; }
export function hasDep(name) {
  try { requireDep(name); return true; } catch { return false; }
}
