#!/usr/bin/env node
// 扫描所有风格 → 生成 plugin/catalog.json（director 选风格用）
// 并刷新 README.md / README.zh-CN.md 里 <!-- gallery --> 与 <!-- progress --> 之间的内容。
// 用法：node tools/build-catalog.mjs [--check]   --check 只校验是否最新（CI 用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.WUKONG_ANIMATION_HOME = process.env.WUKONG_ANIMATION_HOME || path.join(ROOT, '.tmp-home'); // 不把用户风格写进目录
const { getStyles, getRegistry } = await import(path.join(ROOT, 'plugin/engine/core/registry.mjs'));
const { resolveStyle } = await import(path.join(ROOT, 'plugin/engine/core/resolver.mjs'));

const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/plan72.json'), 'utf8'));
const { styles, problems } = getStyles();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
const reg = getRegistry();

function bestFor(dir) {
  const f = path.join(dir, 'STYLE.md');
  if (!fs.existsSync(f)) return [];
  const m = fs.readFileSync(f, 'utf8').match(/^适合[:：]\s*(.+)$/m);
  return m ? m[1].split(/[、,，]/).map((s) => s.trim()).filter(Boolean) : [];
}

const entries = plan.styles.map(([id, name, category, pipeline, kits], i) => {
  const st = styles.get(id);
  if (!st) return { id, order: i + 1, name, category, categoryName: plan.categories[category], status: 'planned', pipeline, kits };
  const ok = resolveStyle(st, reg).errors.length === 0;
  const examples = fs.existsSync(path.join(st.dir, 'examples'))
    ? fs.readdirSync(path.join(st.dir, 'examples')).filter((d) => fs.existsSync(path.join(st.dir, 'examples', d, 'film.json')))
    : [];
  return {
    id,
    order: st.order,
    name: st.name,
    name_en: st.name_en,
    category: st.category,
    categoryName: plan.categories[st.category],
    status: ok ? 'available' : 'broken',
    pipeline: st.pipeline,
    kits: Object.keys(st.kits),
    keywords: st.keywords,
    best_for: bestFor(st.dir),
    skill: `skills/${id}`,
    examples: examples.map((e) => `skills/${id}/examples/${e}`),
  };
});
// 不在规划表里的内置风格（第 73 变及以后）
for (const st of styles.values()) {
  if (st.origin !== 'builtin' || entries.some((e) => e.id === st.id)) continue;
  entries.push({ id: st.id, order: st.order, name: st.name, category: st.category, categoryName: plan.categories[st.category] || '其他', status: 'available', pipeline: st.pipeline, kits: Object.keys(st.kits), keywords: st.keywords, best_for: bestFor(st.dir), skill: `skills/${st.id}` });
}

const done = entries.filter((e) => e.status === 'available').length;
const catalog = {
  _generated: '由 tools/build-catalog.mjs 生成，请勿手改',
  progress: { done, total: plan.styles.length },
  categories: plan.categories,
  styles: entries,
};
const out = path.join(ROOT, 'plugin/catalog.json');
const text = JSON.stringify(catalog, null, 2) + '\n';

// README 片段
const progress = `**已修成 ${done} / ${plan.styles.length} 变**`;
const rows = Object.entries(plan.categories).map(([cat, cname]) => {
  const list = entries.filter((e) => e.category === cat).map((e) => (e.status === 'available' ? `**${e.name}**` : e.name));
  return `| ${cname} | ${list.join(' · ')} |`;
});
// 有画廊图（node tools/render-stills.mjs）的风格放在表格下方，每行 3 张
const PER_ROW = 3;
// 画廊图只在仓库里（README 用），不写进随插件分发的 catalog.json（#64）
const galleryOf = (id) => `docs/gallery/${id}.jpg`;
const cells = entries.filter((e) => fs.existsSync(path.join(ROOT, galleryOf(e.id)))).map((e) => `<td align="center"><img src="${galleryOf(e.id)}" width="400" alt="${e.name}"><br>${e.name}</td>`);
const picRows = [];
for (let i = 0; i < cells.length; i += PER_ROW) picRows.push(`<tr>${cells.slice(i, i + PER_ROW).join('')}</tr>`);
const pics = picRows.length ? ['', '<table>', ...picRows, '</table>'] : [];
const gallery = ['| 分类 | 风格（加粗 = 已可用） |', '|---|---|', ...rows, ...pics].join('\n');

const replaceBlock = (src, tag, body) =>
  src.replace(new RegExp(`(<!-- ${tag} -->)[\\s\\S]*?(<!-- /${tag} -->)`), `$1\n${body}\n$2`);

const check = process.argv.includes('--check');
let stale = false;
if (check) {
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) stale = true;
} else {
  fs.writeFileSync(out, text);
}
for (const f of ['README.md', 'README.zh-CN.md']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  const next = replaceBlock(replaceBlock(src, 'progress', progress), 'gallery', gallery);
  if (check) stale ||= next !== src;
  else fs.writeFileSync(p, next);
}
fs.rmSync(path.join(ROOT, '.tmp-home'), { recursive: true, force: true });
if (check && stale) {
  console.error('catalog.json 或 README 不是最新的，请运行 node tools/build-catalog.mjs');
  process.exit(1);
}
console.log(`${check ? '校验通过' : '已生成'} catalog.json：${done} / ${plan.styles.length} 变可用`);
