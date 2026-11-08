// Private UI state is independent of formal approvals and production writes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { atomicJson, digest } from './evidence.mjs';
import { assertCompatibleProgress } from './state.mjs';
import { scopedPath, workbenchJson } from './workbench-catalog.mjs';

function scope(dir) { const root = fs.realpathSync(path.resolve(dir)); assertCompatibleProgress(root); scopedPath(root, '.wka/workbench-local/state.json'); return root; }
export function readWorkbenchUI(dir) {
  const root = scope(dir), value = workbenchJson(scopedPath(root, '.wka/workbench-local/state.json'), { version: 1, entries: {} });
  if (value.version !== 1 || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) throw new Error('本机草稿记录损坏或版本较新，不会覆盖');
  return value;
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function writeWorkbenchUI(dir, { key, expected, value }) {
  const root = scope(dir);
  if (typeof key !== 'string' || !/^(?:film|layout|(?:note|stage|position):[\w:.-]{1,200})$/.test(key) || !Number.isInteger(expected) || expected < 0 || value === undefined || JSON.stringify(value).length > 40000) throw new Error('草稿键或内容格式无效');
  const folder = scopedPath(root, '.wka/workbench-local'), lock = scopedPath(root, '.wka/workbench-local/write.lock');
  fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(scopedPath(root, '.wka/workbench-local/.gitignore'), '*\n!.gitignore\n');
  let held = false;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { const fd = fs.openSync(lock, 'wx'); held = true; try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname() })); } finally { fs.closeSync(fd); } break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const owner = workbenchJson(lock, null);
        if (!owner || owner.host !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid < 1 || alive(owner.pid)) throw new Error('其他页面正在保存草稿，请稍后重试');
        fs.rmSync(lock);
      }
    }
    if (!held) throw new Error('草稿存储忙，请重试');
    const data = readWorkbenchUI(root), old = Object.hasOwn(data.entries, key) ? data.entries[key] : null;
    if (old?.revision === expected + 1 && digest(old.value) === digest(value)) return old;
    if ((old?.revision || 0) !== expected) throw new Error('草稿冲突：其他页面已更新，本页内容仍保留，请核对后重试');
    const entry = { revision: expected + 1, value, at: new Date().toISOString() };
    data.entries[key] = entry; atomicJson(scopedPath(root, '.wka/workbench-local/state.json'), data); return entry;
  } finally { if (held) fs.rmSync(lock, { force: true }); }
}

export function workbenchStatus(dir) {
  const root = scope(dir), rows = [];
  const walk = (file, key) => {
    let st; try { st = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') { rows.push([key, null]); return; } throw error; }
    if (st.isSymbolicLink()) { rows.push([key, 'link']); return; }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) if (!name.startsWith('.') && name !== 'node_modules') walk(path.join(file, name), key + '/' + name);
    } else if (st.isFile()) rows.push([key, st.size, st.mtimeMs, st.ctimeMs]);
  };
  walk(root, '.');
  for (const rel of ['.wka/workbench.json', '.wka/final-delivery.json', '.wka/decisions.json', '.wka/state.json', '.cache/operations.json']) walk(scopedPath(root, rel), rel);
  const ledger = workbenchJson(scopedPath(root, '.wka/workbench.json'), { registrations: [], artifacts: [] });
  const external = new Set([...ledger.registrations || [], ...ledger.artifacts || []].filter(x => x.external).map(x => x.path));
  for (const file of external) walk(file, 'external:' + file);
  return { revision: digest(rows), busy: fs.existsSync(scopedPath(root, '.cache/operation.lock')), at: new Date().toISOString() };
}
