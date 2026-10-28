// wka new style：从引擎模板生成风格目录（用户自建 / 维护者经 tools/new-style.mjs 贡献）。只跑 CLI，不渲染。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WKA = path.join(ROOT, 'plugin/engine/bin/wka.mjs');
const NEW_STYLE = path.join(ROOT, 'tools/new-style.mjs');
const FILES = ['SKILL.md', 'STYLE.md', 'TECH.md', 'style.json', 'scripts/style.js'];

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wka-new-style-'));
const run = (script, home, ...args) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, WUKONG_ANIMATION_HOME: home },
  });
const styleJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'style.json'), 'utf8'));

test('默认生成到用户风格目录，占位符全部替换，category 为 custom、order 为 101', () => {
  const home = tmp();
  const r = run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸');
  assert.equal(r.status, 0, r.stderr);
  const dir = path.join(home, 'styles', 'paper-cut');
  for (const f of FILES) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(text, /__[A-Z_]+__/, `${f} 残留占位符`);
  }
  const json = styleJson(dir);
  assert.equal(json.id, 'paper-cut');
  assert.equal(json.name, '剪纸');
  assert.equal(json.category, 'custom');
  assert.equal(json.order, 101);
  assert.match(fs.readFileSync(path.join(dir, 'scripts/style.js'), 'utf8'), /paperCut/);
});

test('--dest、--category、--order 生效', () => {
  const home = tmp();
  const dest = path.join(tmp(), 'nested', 'skills');
  const r = run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸', '--category', 'dongfang', '--order', '7', '--dest', dest);
  assert.equal(r.status, 0, r.stderr);
  const json = styleJson(path.join(dest, 'paper-cut'));
  assert.equal(json.category, 'dongfang');
  assert.equal(json.order, 7);
  assert.equal(fs.existsSync(path.join(home, 'styles', 'paper-cut')), false);
});

test('新建的用户风格出现在 wka list styles 里', () => {
  const home = tmp();
  assert.equal(run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸').status, 0);
  const r = run(WKA, home, 'list', 'styles');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /paper-cut/);
});

test('目标已存在时拒绝，原有文件不变', () => {
  const home = tmp();
  assert.equal(run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸').status, 0);
  const file = path.join(home, 'styles', 'paper-cut', 'STYLE.md');
  fs.writeFileSync(file, '已经写过的内容');
  const r = run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸');
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), '已经写过的内容');
});

test('缺 --name、id 不合法、未知类别：失败且不建目录', () => {
  const home = tmp();
  for (const args of [
    ['new', 'style', 'paper-cut'],
    ['new', 'style', 'Paper_Cut', '--name', '剪纸'],
    ['new', 'kit', 'paper-cut', '--name', '剪纸'],
  ]) {
    const r = run(WKA, home, ...args);
    assert.notEqual(r.status, 0, args.join(' '));
  }
  assert.equal(fs.existsSync(path.join(home, 'styles')), false);
});

test('tools/new-style.mjs 按 plan72.json 取规划序号并写到 --dest', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/plan72.json'), 'utf8'));
  const [id] = plan.styles.find(([sid]) => !fs.existsSync(path.join(ROOT, 'plugin/skills', sid)));
  const order = plan.styles.findIndex(([sid]) => sid === id) + 1;
  const dest = tmp();
  const r = run(NEW_STYLE, tmp(), id, '--name', '测试', '--category', 'shouhui', '--dest', dest);
  assert.equal(r.status, 0, r.stderr);
  const json = styleJson(path.join(dest, id));
  assert.equal(json.order, order);
  assert.equal(json.category, 'shouhui');
});

test('--order 不是 1–999 的整数时失败，不建目录', () => {
  const home = tmp();
  for (const order of ['abc', '0', '1000', '3.5']) {
    const r = run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸', '--order', order);
    assert.notEqual(r.status, 0, `--order ${order}`);
  }
  assert.equal(fs.existsSync(path.join(home, 'styles')), false);
});

test('建在插件外：$schema 指向 GitHub 上的 schema；建在 plugin/skills 下：保持相对路径', () => {
  const home = tmp();
  assert.equal(run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸').status, 0);
  assert.equal(
    styleJson(path.join(home, 'styles', 'paper-cut')).$schema,
    'https://raw.githubusercontent.com/wukongnotnull/wukong-animation/main/plugin/engine/schemas/style.schema.json'
  );
  const skills = path.join(ROOT, 'plugin/skills');
  const id = 'zz-schema-test';
  try {
    assert.equal(run(WKA, home, 'new', 'style', id, '--name', '测试', '--dest', skills).status, 0);
    const dir = path.join(skills, id);
    const schema = styleJson(dir).$schema;
    assert.equal(schema, '../../engine/schemas/style.schema.json');
    assert.ok(fs.existsSync(path.resolve(dir, schema)));
  } finally {
    fs.rmSync(path.join(skills, id), { recursive: true, force: true });
  }
});
