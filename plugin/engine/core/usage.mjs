// 影片目录的磁盘占用与深度清理清单。清理只删能由源文件重新生成的东西，被签批、批注、交付账本引用的文件一律保留。
import fs from 'node:fs';
import path from 'node:path';
import { FINAL_DIR, REVIEW_DIR } from './layout.mjs';

const USAGE_DIRS = ['.cache', '.wka', REVIEW_DIR, FINAL_DIR, 'media', 'audio', '资料', 'shots'];
const REGENERABLE_REVIEW = /\.(mp4|m4a|png|jpe?g)$/i;
const KEEP_IN_CACHE = new Set(['operation.lock', 'active-command.json', 'render-speed.json']);

function sizeOf(target) {
  let stat;
  try { stat = fs.lstatSync(target); } catch { return 0; }
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const name of fs.readdirSync(target)) total += sizeOf(path.join(target, name));
  return total;
}

export const formatBytes = bytes => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB`
  : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))} KB`;

/** 各目录占用（字节），不存在的目录不列出。 */
export function filmUsage(filmDir) {
  const root = path.resolve(filmDir);
  return USAGE_DIRS.filter(name => fs.existsSync(path.join(root, name))).map(name => ({ name, bytes: sizeOf(path.join(root, name)) }));
}

function walkFiles(directory, out = []) {
  if (!fs.existsSync(directory)) return out;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(file, out);
    else if (entry.isFile()) out.push(file);
  }
  return out;
}

/** 正式记录里写到的内容：.wka 下除对象库以外的 JSON、交付校验清单和签批回执。 */
function referenceText(root) {
  const texts = [];
  const collect = directory => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (!['objects', 'approved'].includes(entry.name)) collect(file); }
      else if (entry.name.endsWith('.json')) texts.push(fs.readFileSync(file, 'utf8'));
    }
  };
  collect(path.join(root, '.wka'));
  for (const file of walkFiles(path.join(root, REVIEW_DIR, '交付'))) if (file.endsWith('.json')) texts.push(fs.readFileSync(file, 'utf8'));
  return texts.join('\n');
}

/** 深度清理清单：[{ group, file, bytes }]。 */
export function planDeepClean(filmDir) {
  const root = path.resolve(filmDir);
  const plan = [];
  const add = (group, file) => plan.push({ group, file, bytes: sizeOf(file) });
  const cache = path.join(root, '.cache');
  if (fs.existsSync(cache)) for (const name of fs.readdirSync(cache)) if (!KEEP_IN_CACHE.has(name)) add('缓存（渲染片段、混音、中间文件）', path.join(cache, name));
  const references = referenceText(root);
  for (const file of walkFiles(path.join(root, REVIEW_DIR))) {
    if (!REGENERABLE_REVIEW.test(file)) continue;
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (references.includes(rel)) continue;
    add('审阅副本（小样、静帧、声轨、抽帧；未被签批或交付记录引用）', file);
  }
  const objects = path.join(root, '.wka/workbench/objects');
  if (fs.existsSync(objects)) {
    for (const name of fs.readdirSync(objects)) {
      if (!/^[a-f0-9]{64}$/.test(name) || references.includes(name)) continue;
      add('工作台对象库（没有登记版本引用的快照）', path.join(objects, name));
    }
  }
  return plan;
}

/** 删除清单里的项目，返回删除条数。 */
export function runDeepClean(plan) {
  for (const item of plan) fs.rmSync(item.file, { recursive: true, force: true });
  return plan.length;
}
