#!/usr/bin/env node
// 仓库校验：插槽清单、风格目录结构、skill frontmatter、catalog 是否最新。
// 用法：node tools/lint.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.join(ROOT, 'plugin');
process.env.WUKONG_ANIMATION_HOME = path.join(ROOT, '.tmp-home');
const { getRegistry, getStyles } = await import(path.join(PLUGIN, 'engine/core/registry.mjs'));
const { resolveStyle } = await import(path.join(PLUGIN, 'engine/core/resolver.mjs'));
const { validate } = await import(path.join(PLUGIN, 'engine/core/validate.mjs'));
const { missingJianyingFonts } = await import(path.join(PLUGIN, 'engine/exporters/jianying/fonts.mjs'));
const { subtitleStyle } = await import(path.join(PLUGIN, 'engine/core/subtitle-layer.mjs'));

const errors = [];
const warns = [];
const rel = (p) => path.relative(ROOT, p);

function frontmatter(file) {
  const m = fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const o = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) o[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return o;
}

// 1. JSON 清单
for (const f of ['.claude-plugin/marketplace.json', 'plugin/.claude-plugin/plugin.json']) {
  try {
    JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  } catch (e) {
    errors.push(`${f}: ${e.message}`);
  }
}

// 2. 插槽
const reg = getRegistry({ fresh: true });
errors.push(...reg.problems);
for (const k of reg.kits.values()) {
  if (!fs.existsSync(path.join(k.dir, 'README.md'))) errors.push(`kit ${k.name}: 缺少 README.md（运行 node tools/build-docs.mjs）`);
  for (const dep of Object.keys(k.kits || {})) if (!reg.kits.has(dep)) errors.push(`kit ${k.name}: 依赖的 kit "${dep}" 未注册`);
}
for (const p of reg.pipelines.values()) if (!fs.existsSync(p.entryPath)) errors.push(`pipeline ${p.name}: 缺少 ${p.entry}`);
for (const e of reg.exporters.values()) if (!fs.existsSync(e.entryPath)) errors.push(`exporter ${e.name}: 缺少 ${e.entry}`);

// 3. skills
const skillsDir = path.join(PLUGIN, 'skills');
for (const d of fs.readdirSync(skillsDir, { withFileTypes: true }).filter((x) => x.isDirectory())) {
  const dir = path.join(skillsDir, d.name);
  const skill = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skill)) {
    errors.push(`${rel(dir)}: 缺少 SKILL.md`);
    continue;
  }
  const fm = frontmatter(skill);
  if (!fm) errors.push(`${rel(skill)}: 缺少 frontmatter`);
  else {
    if (fm.name !== d.name) errors.push(`${rel(skill)}: name "${fm.name}" 应与目录名 "${d.name}" 一致`);
    if (!fm.description) errors.push(`${rel(skill)}: 缺少 description`);
    else if (fm.description.length > 1024) errors.push(`${rel(skill)}: description 超过 1024 字符`);
    else if (fm.description.length > 200) warns.push(`${rel(skill)}: description ${fm.description.length} 字符，72 个风格常驻上下文，建议 ≤ 200`);
  }
}

// 4. 风格
for (const f of missingJianyingFonts([subtitleStyle({}).font.family])) errors.push(`引擎缺省字幕字体 "${f}" 在剪映字体对照表里没有对应项（plugin/engine/exporters/jianying/fonts.json）`);
const { styles, problems } = getStyles();
errors.push(...problems);
const ids = new Map();
for (const st of styles.values()) {
  const where = rel(st.dir);
  for (const f of ['STYLE.md', 'TECH.md']) if (!fs.existsSync(path.join(st.dir, f))) errors.push(`${where}: 缺少 ${f}`);
  const styleMd = path.join(st.dir, 'STYLE.md');
  if (fs.existsSync(styleMd)) {
    const src = fs.readFileSync(styleMd, 'utf8');
    for (let i = 1; i <= 9; i++) if (!new RegExp(`^## ${i}\\. `, 'm').test(src)) errors.push(`${where}/STYLE.md: 缺少第 ${i} 段（"## ${i}. …"）`);
  }
  for (const s of st.scripts || []) if (!fs.existsSync(path.join(st.dir, s))) errors.push(`${where}: scripts 中的 ${s} 不存在`);
  const r = resolveStyle(st, reg);
  for (const e of r.errors) (st.origin === 'builtin' ? errors : warns).push(`${where}: ${e}`);
  if (!st.qc) warns.push(`${where}: style.json 没有 qc 阈值，wka qc 只能检查帧差`);
  if (ids.has(st.order)) errors.push(`${where}: order ${st.order} 与 ${ids.get(st.order)} 重复`);
  ids.set(st.order, st.id);
  // 剪映草稿的字幕字体要有对照，否则剪映里会悄悄变成默认字体
  const subFont = st.subtitles?.font?.family;
  for (const f of missingJianyingFonts(subFont ? [subFont] : [])) errors.push(`${where}: 字幕字体 "${f}" 在剪映字体对照表里没有对应项（plugin/engine/exporters/jianying/fonts.json，没有合适的剪映字体就写 null）`);
  // 内置风格必须带示范片：冒烟测试靠它做确定性与基准图比对，没有就等于没测
  const ex = path.join(st.dir, 'examples');
  const films = fs.existsSync(ex) ? fs.readdirSync(ex).filter((e) => fs.existsSync(path.join(ex, e, 'film.json'))) : [];
  if (!films.length) (st.origin === 'builtin' ? errors : warns).push(`${where}: 没有示范片 examples/<片名>/film.json（冒烟测试需要它）`);
  else {
    for (const e of films) {
      const fj = path.join(ex, e, 'film.json');
      const film = JSON.parse(fs.readFileSync(fj, 'utf8'));
      for (const msg of validate('film', film, `${where}/examples/${e}/film.json`)) errors.push(msg);
      if (film.style !== st.id) errors.push(`${where}/examples/${e}: film.json 的 style 应为 ${st.id}`);
      for (const sh of film.shots || []) if (!fs.existsSync(path.join(ex, e, sh.file))) errors.push(`${where}/examples/${e}: 缺少 ${sh.file}`);
      for (const sc of film.scripts || []) if (!fs.existsSync(path.join(ex, e, sc))) errors.push(`${where}/examples/${e}: 缺少 ${sc}`);
    }
  }
}

// 5. catalog 是否最新
const c = spawnSync(process.execPath, [path.join(ROOT, 'tools/build-catalog.mjs'), '--check'], { encoding: 'utf8' });
if (c.status !== 0) errors.push((c.stderr || c.stdout).trim());

fs.rmSync(path.join(ROOT, '.tmp-home'), { recursive: true, force: true });
for (const w of warns) console.log(`  ! ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);
console.log(errors.length ? `\n✗ ${errors.length} 个错误` : `\n✓ lint 通过（${styles.size} 个风格，${reg.pipelines.size} 条管线，${reg.kits.size} 个工具包，${reg.exporters.size} 个导出器）`);
process.exit(errors.length ? 1 : 0);
