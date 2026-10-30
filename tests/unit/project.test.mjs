import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertIgnoreBlock } from '../../plugin/engine/core/project.mjs';

const BEGIN = '# >>> wukong-animation >>>';
const END = '# <<< wukong-animation <<<';

test('a new .gitignore gets the block, which ignores the review folder', () => {
  const out = upsertIgnoreBlock('');
  assert.ok(out.startsWith(BEGIN));
  assert.match(out, /^films\/\*\/review\/$/m);
});

test('an outdated block is replaced and the lines around it are kept', () => {
  const old = `dist/\n\n${BEGIN}\nfilms/*/.cache/\n${END}\n\nmy-notes.txt\n`;
  const out = upsertIgnoreBlock(old);
  assert.ok(out.startsWith('dist/\n\n' + BEGIN));
  assert.ok(out.endsWith(`${END}\n\nmy-notes.txt\n`));
  assert.match(out, /^films\/\*\/review\/$/m);
  assert.equal(out.split(BEGIN).length, 2);
});

test('a current block is left as it is', () => {
  const once = upsertIgnoreBlock('dist/\n');
  assert.equal(upsertIgnoreBlock(once), once);
});

test('a block whose end marker was deleted is left alone, so lines after it are not lost', () => {
  const broken = `${BEGIN}\nfilms/*/.cache/\nmine\n`;
  assert.equal(upsertIgnoreBlock(broken), broken);
});

test('CRLF line endings after the block leave no stray carriage return', () => {
  const out = upsertIgnoreBlock(`${BEGIN}\r\nold\r\n${END}\r\nb\r\n`);
  assert.ok(out.endsWith(`${END}\nb\r\n`));
});

// ── initProject 在已有提交的仓库里更新段落 ──
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initProject } from '../../plugin/engine/core/project.mjs';

function repoWithOldBlock() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-proj-'));
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q');
  g('config', 'user.name', 't');
  g('config', 'user.email', 't@t');
  fs.writeFileSync(path.join(dir, '.gitignore'), `dist/\n\n${BEGIN}\nfilms/*/.cache/\n${END}\n`);
  g('add', '.gitignore');
  g('commit', '-qm', 'init');
  return { dir, g };
}

test('updating the block in a repo with commits also commits .gitignore', () => {
  const { dir, g } = repoWithOldBlock();
  const logs = [];
  initProject(dir, { log: (m) => logs.push(m) });
  assert.equal(g('status', '--porcelain', '--', '.gitignore').stdout.trim(), '');
  assert.match(g('log', '-1', '--format=%s').stdout, /更新 \.gitignore/);
  assert.ok(logs.some((m) => /已提交 \.gitignore/.test(m)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a .gitignore with the user\'s own uncommitted edits is updated but not committed', () => {
  const { dir, g } = repoWithOldBlock();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'mine/\n' + fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'));
  const logs = [];
  initProject(dir, { log: (m) => logs.push(m) });
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /films\/\*\/review\//);
  assert.match(g('log', '-1', '--format=%s').stdout, /^init/);
  assert.ok(logs.some((m) => /请自己提交/.test(m)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a tracked .gitignore the user deleted without committing is not committed for them', () => {
  const { dir, g } = repoWithOldBlock();
  fs.rmSync(path.join(dir, '.gitignore'));
  const logs = [];
  initProject(dir, { log: (m) => logs.push(m) });
  assert.match(g('log', '-1', '--format=%s').stdout, /^init/);
  assert.ok(logs.some((m) => /请自己提交/.test(m)));
  fs.rmSync(dir, { recursive: true, force: true });
});

function unbornRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-first-commit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const g = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  for (const args of [['init', '-q'], ['config', 'user.name', 'test'], ['config', 'user.email', 'test@example.com'], ['config', 'commit.gpgsign', 'false']]) {
    const r = g(...args);
    assert.equal(r.status, 0, r.stderr);
  }
  const file = path.join(dir, 'user-script.sh');
  fs.writeFileSync(file, '#!/bin/sh\necho staged\n');
  assert.equal(g('add', '--', 'user-script.sh').status, 0);
  assert.equal(g('update-index', '--chmod=+x', '--', 'user-script.sh').status, 0);
  fs.writeFileSync(file, '#!/bin/sh\necho unstaged\n');
  const index = g('ls-files', '--stage', '--', 'user-script.sh').stdout;
  const working = fs.readFileSync(file);
  const diff = g('diff', '--', 'user-script.sh').stdout;
  return { dir, g, checkUnrelated() {
    assert.equal(g('ls-files', '--stage', '--', 'user-script.sh').stdout, index);
    assert.deepEqual(fs.readFileSync(file), working);
    assert.equal(g('diff', '--', 'user-script.sh').stdout, diff);
    assert.match(g('diff', '--cached', '--name-only').stdout, /user-script\.sh/);
  } };
}

test('first commit contains only .gitignore and preserves staged and unstaged user content', (t) => {
  const { dir, g, checkUnrelated } = unbornRepo(t);
  initProject(dir, { log: () => {} });
  assert.equal(g('ls-tree', '-r', '--name-only', 'HEAD').stdout.trim(), '.gitignore');
  checkUnrelated();
});

test('a fresh empty repository still creates its initial ignore-only commit', (t) => {
  const { dir, g } = unbornRepo(t);
  assert.equal(g('rm', '--cached', '-f', '--', 'user-script.sh').status, 0);
  fs.unlinkSync(path.join(dir, 'user-script.sh'));
  const logs = [];
  initProject(dir, { log: message => logs.push(message) });
  assert.equal(g('ls-tree', '-r', '--name-only', 'HEAD').stdout.trim(), '.gitignore');
  assert.ok(logs.some(message => message.includes('已创建初始提交')));
});

test('failed initial commit keeps unrelated index entries and worktree differences', (t) => {
  const { dir, g, checkUnrelated } = unbornRepo(t);
  const hooks = path.join(dir, 'reject-hooks');
  fs.mkdirSync(hooks);
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.equal(g('config', 'core.hooksPath', hooks).status, 0);
  const logs = [];
  initProject(dir, { log: message => logs.push(message) });
  assert.notEqual(g('rev-parse', '--verify', 'HEAD').status, 0);
  checkUnrelated();
  assert.ok(logs.some(message => message.includes('初始提交失败')));
  assert.equal(logs.some(message => message.includes('已创建初始提交')), false);
});

test('missing identity leaves an unborn repository and its user index untouched', (t) => {
  const { dir, g, checkUnrelated } = unbornRepo(t);
  // 只隔离此同步调用的 Git 配置，避免本机全局身份让缺身份场景失真。
  for (const key of ['user.name', 'user.email']) assert.equal(g('config', '--unset-all', key).status, 0);
  const oldGlobal = process.env.GIT_CONFIG_GLOBAL, oldSystem = process.env.GIT_CONFIG_NOSYSTEM;
  process.env.GIT_CONFIG_GLOBAL = path.join(dir, 'absent-global-config');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  const logs = [];
  try { initProject(dir, { log: message => logs.push(message) }); }
  finally {
    if (oldGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = oldGlobal;
    if (oldSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = oldSystem;
  }
  assert.notEqual(g('rev-parse', '--verify', 'HEAD').status, 0);
  checkUnrelated();
  assert.ok(logs.some(message => message.includes('尚未配置 git 身份')));
});
