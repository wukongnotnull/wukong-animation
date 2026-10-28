// brief / story / storyboard 的结构只在模板里定义一次（#70）：规范文件写怎么填，示范片照着模板写。
// 这里从模板读出结构去核对示范片和规范的说明表，测试里不另写一份栏目、章节清单。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGIN = path.join(ROOT, 'plugin');
const TEMPLATES = ['engine/templates/brief.md', 'engine/templates/film/story.md', 'engine/templates/film/storyboard.md'];

const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(ROOT, file);
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isSeparator = (line) => /^\|[\s:|-]+\|$/.test(line.trim());

/** 文中所有表格：表头和各行单元格。 */
function tables(src) {
  const out = [];
  let cur = null;
  for (const line of src.split('\n')) {
    if (!line.startsWith('|')) { cur = null; continue; }
    if (isSeparator(line)) continue;
    if (!cur) out.push((cur = { header: cells(line), rows: [] }));
    else cur.rows.push(cells(line));
  }
  return out;
}

/** 结构：按出现顺序的 `##` 章节、加粗项、表头；首列是「项」的表，各行项名也算结构。 */
function structure(src) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^## (.+)$/);
    const b = line.match(/^- \*\*(.+?)\*\*：/);
    if (h) out.push(`## ${h[1].trim()}`);
    else if (b) out.push(`**${b[1]}**`);
    else if (line.startsWith('|') && !lines[i - 1]?.startsWith('|')) out.push(`| ${cells(line).join(' | ')} |`);
  }
  for (const t of tables(src).filter((t) => t.header[0] === '项')) out.push(...t.rows.map((r) => `项：${r[0]}`));
  return out;
}

/** 规范里表头含 `marker` 的那张表，取名为 `name` 的列。 */
function column(src, marker, name) {
  const t = tables(src).find((t) => t.header.includes(marker));
  assert.ok(t, `没有表头含「${marker}」的表`);
  const i = t.header.indexOf(name);
  return t.rows.map((r) => r[i]);
}

/** 模板该填的条目：brief 是各加粗项和规格表的项，story 是基本信息加各章节，storyboard 是逐镜表的栏目。 */
function entries(src) {
  const s = structure(src);
  const items = s.filter((x) => x.startsWith('**') || x.startsWith('项：')).map((x) => x.replace(/^\*\*|\*\*$|^项：/g, ''));
  if (items.length) {
    // 加粗项与规格表的项按文中位置排序：规格表所在章节的项排在该章节。
    const order = (name) => src.indexOf(src.includes(`**${name}**`) ? `**${name}**` : `| ${name} |`);
    return items.sort((a, b) => order(a) - order(b));
  }
  const board = tables(src).find((t) => t.header[0] === '镜');
  if (board) return board.header;
  return ['基本信息', ...s.filter((x) => x.startsWith('## ')).map((x) => x.slice(3))];
}

/** 分镜末尾的「副版重排」表是第 14 道改版时才加的（STORYBOARD.md「六、副版重排」），不属于模板骨架。 */
const withoutVariantAppendix = (src) => src.split(/^## 副版重排/m)[0];

const examples = (base) => {
  const skills = path.join(PLUGIN, 'skills');
  return fs.readdirSync(skills).flatMap((id) => {
    const ex = path.join(skills, id, 'examples');
    return fs.existsSync(ex) ? fs.readdirSync(ex).map((f) => path.join(ex, f, base)).filter((f) => fs.existsSync(f)) : [];
  });
};

/** 规范里逐项说明表的定位：表头含哪一格、取哪一列。 */
const SPEC_TABLE = { 'brief.md': ['推荐答案 / 说明', '项'], 'story.md': ['写到什么程度', '部分'], 'storyboard.md': ['写什么', '栏目'] };

for (const t of TEMPLATES) {
  const file = path.join(PLUGIN, t);
  const src = read(file);
  const base = path.basename(t);
  const spec = src.split('\n')[0].match(/^<!-- 写法见 (skills\/director\/specs\/[\w-]+\.md) -->$/)?.[1];

  test(`${t} 首行注释指向存在的规范文件`, () => {
    assert.ok(spec, `${t} 第一行应是 <!-- 写法见 skills/director/specs/X.md -->`);
    assert.ok(fs.existsSync(path.join(PLUGIN, spec)), `${spec} 不存在`);
  });

  test(`${t} 只有骨架，不带括号写法说明和引用说明`, () => {
    const notes = src.split('\n').filter((l) => /^>|（/.test(l));
    assert.deepEqual(notes, []);
  });

  test(`${t} 的规范写了模板路径，说明表与模板逐项对应`, () => {
    assert.ok(spec, `${t} 第一行没有指向规范文件的注释`);
    const specSrc = read(path.join(PLUGIN, spec));
    assert.ok(specSrc.includes(`\`${t}\``), `${spec} 里没写模板路径 \`${t}\``);
    const [marker, name] = SPEC_TABLE[base];
    const listed = column(specSrc, marker, name);
    assert.deepEqual(listed.slice(0, entries(src).length), entries(src));
  });

  for (const ex of examples(base)) {
    test(`${rel(ex)} 的结构与模板一致`, () => {
      assert.deepEqual(structure(withoutVariantAppendix(read(ex))), structure(src));
    });
  }
}

test('每种模板至少核对了一部示范片', () => {
  for (const t of TEMPLATES) assert.ok(examples(path.basename(t)).length >= 1, t);
});
