// 镜头级渲染缓存：镜头代码、依赖文件、渲染参数都没变，就直接复用上次的片段。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir } from './paths.mjs';

// 文件部件只哈希文件名和内容，不哈希绝对路径：插件每个版本装在不同目录，
// 带上路径会让每次更新后所有镜头缓存失效。各部件按顺序哈希，内容前带长度，
// 文件互换内容或内容在相邻文件间挪动都会改变哈希。
export function hashParts(parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) {
    if (p && typeof p === 'object' && p.file) {
      const body = fs.existsSync(p.file) ? fs.readFileSync(p.file) : null;
      h.update(`file:${path.basename(p.file)}:${body ? body.length : 'MISSING'}\n`);
      if (body) h.update(body);
    } else {
      h.update(typeof p === 'string' ? p : JSON.stringify(p));
    }
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

export class ShotCache {
  constructor(filmDir) {
    this.dir = ensureDir(path.join(filmDir, '.cache'));
    this.file = path.join(this.dir, 'manifest.json');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { shots: {} };
    // 上次进程被强杀时留下的半成品
    const seg = path.join(this.dir, 'segments');
    if (fs.existsSync(seg)) for (const f of fs.readdirSync(seg)) if (f.endsWith('.part')) fs.rmSync(path.join(seg, f), { force: true });
  }
  segmentPath(key, hash) {
    return path.join(ensureDir(path.join(this.dir, 'segments')), `${key}-${hash}.mp4`);
  }
  /** 命中则返回片段路径，否则返回 null。 */
  lookup(key, hash) {
    const hit = this.data.shots[key];
    if (hit && hit.hash === hash && fs.existsSync(hit.file)) return hit.file;
    return null;
  }
  store(key, hash, file) {
    const old = this.data.shots[key];
    if (old && old.file !== file && fs.existsSync(old.file)) fs.rmSync(old.file);
    this.data.shots[key] = { hash, file, at: new Date().toISOString() };
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}
