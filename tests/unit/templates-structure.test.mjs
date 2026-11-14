// brief / story / storyboard 的结构由模板定义，规范文件说明怎么填。
// 用新建的影片核对模板实际生成的结构，并检查现有示范片（如有）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

/** 第 8 道调整画幅时增加的「副画幅重排」表不属于模板骨架；兼容历史名称「副版重排」。 */
const withoutVariantAppendix = (src) => src.split(/^## 副(?:画幅|版)重排/m)[0];

test('分镜骨架检查排除当前和历史名称的画幅重排附表', () => {
  const body = '# 分镜稿\n\n## 声音铺底\n\n';
  for (const heading of ['副画幅重排', '副版重排']) {
    const source = `${body}## ${heading}（9:16）\n\n| 镜 | 处理方式 | 怎么排 |\n`;
    assert.equal(withoutVariantAppendix(source), body);
  }
  assert.equal(withoutVariantAppendix(body), body);
});

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
    test(`${rel(ex)} 的历史内容可读取，当前模板只约束新项目`, () => {
      if (base === 'brief.md') { assert.match(read(ex), /目的|受众/);return; }
      assert.deepEqual(structure(withoutVariantAppendix(read(ex))), structure(src));
    });
  }
}

test('剧本模板不写分镜稿才决定的画面、声音和文字形式', () => {
  const story = read(path.join(PLUGIN, 'engine/templates/film/story.md'));
  assert.match(story, /\| 段落 \| 预计时间 \| 推进作用 \| 情绪变化 \|/);
  assert.match(story, /\| 文字 \| 所在段落 \|/);
  assert.doesNotMatch(story, /声音提示|画面在发生什么|运镜|景别|转场|\| 形式 \|/);
});

test('剧本模板用同一段落编号连接正文、结构、人声与屏幕文字', () => {
  const story = read(path.join(PLUGIN, 'engine/templates/film/story.md'));
  const body = story.split('## 故事正文\n')[1]?.split('\n## ')[0] || '';
  const ids = [...body.matchAll(/^### (P\d+) /gm)].map((match) => match[1]);
  assert.ok(ids.length > 0, '正文应提供可扩展的段落编号');
  assert.equal(new Set(ids).size, ids.length, '段落编号不能重复');
  const paragraphs = column(story, '推进作用', '段落');
  assert.deepEqual(paragraphs, ids);
  const voices = story.split('## 人声文案\n')[1]?.split('\n## ')[0] || '';
  const voiceIds = [...voices.matchAll(/\[(P\d+)\]/g)].map((match) => match[1]);
  assert.ok(voiceIds.length > 0, '人声占位应引用正文段落');
  const textIds = column(story, '所在段落', '所在段落');
  for (const id of [...voiceIds, ...textIds]) assert.ok(ids.includes(id), `引用了不存在的段落 ${id}`);
});

test('新建影片生成三个空白文档，简报、剧本和分镜稿都不写版本号', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-templates-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.join(PLUGIN, 'engine/bin/wka.mjs');
  const env = { ...process.env, WUKONG_ANIMATION_HOME: path.join(dir, 'home') };
  execFileSync(process.execPath, [cli, 'brief', '模板验收', '--dir', dir], { env });
  execFileSync(process.execPath, [cli, 'init', '模板验收', '--style', 'keynote', '--dir', dir], { env });
  for (const template of TEMPLATES) {
    const generated = read(path.join(dir, 'films', '模板验收', path.basename(template)));
    assert.deepEqual(structure(generated), structure(read(path.join(PLUGIN, template))), template);
    assert.doesNotMatch(generated, /版本号|剧本\s*v\d+/);
  }
});
