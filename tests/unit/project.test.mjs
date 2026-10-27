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
