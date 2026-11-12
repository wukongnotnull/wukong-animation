import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { commitPaths } from '../../plugin/engine/core/project.mjs';

function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-review-commit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  for (const args of [['init', '-q'], ['config', 'user.name', 'Fixture'], ['config', 'user.email', 'fixture@example.invalid'], ['config', 'commit.gpgsign', 'false']]) {
    assert.equal(git(...args).status, 0);
  }
  fs.writeFileSync(path.join(dir, '.gitignore'), '/review/**/*.mp4\n/review/**/*.m4a\n/review/**/*.png\n/review/**/*.jpg\n');
  fs.writeFileSync(path.join(dir, 'story.md'), '第一版\n');
  fs.writeFileSync(path.join(dir, 'other.md'), '别的\n');
  initializeProduction(dir);
  assert.equal(git('add', '--', '.gitignore', 'story.md', 'other.md', '.wka/state.json').status, 0);
  assert.equal(git('commit', '-qm', 'init').status, 0);
  return { dir, git };
}

test('only the named files are committed', t => {
  const { dir, git } = repo(t);
  fs.writeFileSync(path.join(dir, 'story.md'), '第二版\n');
  const before = git('rev-parse', 'HEAD').stdout.trim();
  const result = commitPaths(dir, { message: '待审剧本', paths: ['story.md'] });
  assert.equal(result.created, true);
  assert.equal(result.sha, git('rev-parse', 'HEAD').stdout.trim());
  assert.notEqual(result.sha, before);
  assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').stdout.trim(), 'story.md');
  assert.equal(git('show', 'HEAD:story.md').stdout, '第二版\n');
  assert.equal(git('status', '--porcelain').stdout, '');
});

test('a change outside the named files refuses the commit and leaves HEAD untouched', t => {
  const { dir, git } = repo(t);
  fs.writeFileSync(path.join(dir, 'story.md'), '第二版\n');
  fs.writeFileSync(path.join(dir, 'other.md'), '无关\n');
  const before = git('rev-parse', 'HEAD').stdout.trim();
  assert.throws(() => commitPaths(dir, { message: '待审剧本', paths: ['story.md'] }), /范围之外/);
  assert.equal(git('rev-parse', 'HEAD').stdout.trim(), before);
  assert.match(git('status', '--porcelain').stdout, /story\.md/);
  assert.match(git('status', '--porcelain').stdout, /other\.md/);
  assert.equal(git('diff', '--cached', '--name-only').stdout, '');
});

test('an already committed review uses the current commit instead of an empty one', t => {
  const { dir, git } = repo(t);
  fs.mkdirSync(path.join(dir, 'review'));
  fs.writeFileSync(path.join(dir, 'review', 'noise.mp4'), 'ignored');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const count = git('rev-list', '--count', 'HEAD').stdout.trim();
  const result = commitPaths(dir, { message: '待审剧本', paths: ['story.md'] });
  assert.equal(result.created, false);
  assert.equal(result.sha, head);
  assert.equal(git('rev-list', '--count', 'HEAD').stdout.trim(), count);
});
