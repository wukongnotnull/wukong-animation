// 插槽注册表：扫描 pipelines/ kits/ exporters/ 下的子目录，读取清单并自动注册。
// 新增一条管线 / 一个工具包 / 一个导出器 = 新建一个目录，这里的代码永远不用改。
// 以 "_" 开头的目录（如 _template）会被跳过。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SLOT_DIRS, SKILLS_DIR, USER_STYLES_DIR } from './paths.mjs';
import { validate } from './validate.mjs';

const MANIFEST = { pipeline: 'pipeline.json', kit: 'kit.json', exporter: 'exporter.json' };

function listDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => path.join(root, d.name));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function scanSlot(kind) {
  const items = new Map();
  const problems = [];
  for (const dir of listDirs(SLOT_DIRS[kind])) {
    const file = path.join(dir, MANIFEST[kind]);
    if (!fs.existsSync(file)) {
      problems.push(`${kind} ${path.basename(dir)}: 缺少 ${MANIFEST[kind]}`);
      continue;
    }
    let manifest;
    try {
      manifest = readJson(file);
    } catch (e) {
      problems.push(`${kind} ${path.basename(dir)}: ${MANIFEST[kind]} 不是合法 JSON (${e.message})`);
      continue;
    }
    const errs = validate(kind, manifest, `${kind}/${path.basename(dir)}`);
    if (manifest.name && manifest.name !== path.basename(dir)) {
      errs.push(`${kind}/${path.basename(dir)}: name "${manifest.name}" 必须与目录名一致`);
    }
    if (errs.length) {
      problems.push(...errs);
      continue;
    }
    items.set(manifest.name, { ...manifest, kind, dir, entryPath: path.join(dir, manifest.entry) });
  }
  return { items, problems };
}

let _registry = null;

/** 返回 { pipelines, kits, exporters, problems }，结果会缓存。 */
export function getRegistry({ fresh = false } = {}) {
  if (_registry && !fresh) return _registry;
  const p = scanSlot('pipeline');
  const k = scanSlot('kit');
  const e = scanSlot('exporter');
  _registry = {
    pipelines: p.items,
    kits: k.items,
    exporters: e.items,
    problems: [...p.problems, ...k.problems, ...e.problems],
  };
  return _registry;
}

const moduleCache = new Map();

/** 动态加载管线或导出器的实现模块。 */
export async function loadModule(item) {
  if (!moduleCache.has(item.entryPath)) {
    moduleCache.set(item.entryPath, await import(pathToFileURL(item.entryPath).href));
  }
  return moduleCache.get(item.entryPath);
}

/** 扫描内置风格（plugin/skills/<id>/style.json）与用户风格（~/.wukong-animation/styles/<id>/style.json）。 */
export function getStyles() {
  const styles = new Map();
  const problems = [];
  for (const [root, origin] of [
    [SKILLS_DIR, 'builtin'],
    [USER_STYLES_DIR, 'user'],
  ]) {
    for (const dir of listDirs(root)) {
      const file = path.join(dir, 'style.json');
      if (!fs.existsSync(file)) continue; // director、new-style 等非风格 skill
      let style;
      try {
        style = readJson(file);
      } catch (e) {
        problems.push(`style ${path.basename(dir)}: style.json 不是合法 JSON (${e.message})`);
        continue;
      }
      const errs = validate('style', style, `style/${path.basename(dir)}`);
      if (style.id && style.id !== path.basename(dir)) {
        errs.push(`style/${path.basename(dir)}: id "${style.id}" 必须与目录名一致`);
      }
      if (errs.length) {
        problems.push(...errs);
        continue;
      }
      if (styles.has(style.id) && origin === 'user') {
        problems.push(`用户风格 ${style.id} 与内置风格重名，已忽略用户版本`);
        continue;
      }
      styles.set(style.id, { ...style, origin, dir });
    }
  }
  return { styles, problems };
}
