// catalog.json 随插件分发：里面的路径都相对插件根，必须落在 plugin/ 之内（#64）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGIN = path.join(ROOT, 'plugin');
const catalog = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'catalog.json'), 'utf8'));

// 形如 a/b、a/b.jpg 的字符串当作路径（"节气 / 节日" 这类带空格的文案不算）
const PATH_LIKE = /^[\w.-]+(\/[\w.-]+)+$/;

function strings(v, at = '') {
  if (typeof v === 'string') return [[at, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => strings(x, `${at}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => strings(x, at ? `${at}.${k}` : k));
  return [];
}

test('catalog.json 里的路径都能在插件根内解析到', () => {
  const paths = strings(catalog).filter(([, v]) => PATH_LIKE.test(v));
  assert.ok(paths.length > 0, '应至少有 skill / examples 路径');
  for (const [at, v] of paths) {
    const abs = path.resolve(PLUGIN, v);
    assert.ok(abs.startsWith(PLUGIN + path.sep), `${at} = ${v} 跑出了 plugin/`);
    assert.ok(fs.existsSync(abs), `${at} = ${v} 在插件里不存在`);
  }
});

test('风格条目不带 still 字段（画廊图只给 README 用，不随插件分发）', () => {
  for (const s of catalog.styles) assert.ok(!('still' in s), `${s.id} 仍有 still`);
});
