import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { reviewCommands } from '../../plugin/engine/cli/commands/review.mjs';

function film(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-signoff-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  for (const args of [['init', '-q'], ['config', 'user.name', 'Fixture'], ['config', 'user.email', 'fixture@example.invalid'], ['config', 'commit.gpgsign', 'false']]) assert.equal(git(...args).status, 0);
  const put = (name, text) => { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  put('.gitignore', '/review/\n');
  put('brief.md', '简报');
  put('story.md', '剧本');
  put('other.md', '无关');
  put('.wka/state.json', JSON.stringify({ flow: 6, step: 2, history: [] }));
  put('.wka/decisions.json', JSON.stringify({ version: 1, delivery: { status: 'confirmed', value: 'video', source: '用户确认' } }));
  assert.equal(git('add', '--', '.gitignore', 'brief.md', 'story.md', 'other.md', '.wka/state.json', '.wka/decisions.json').status, 0);
  assert.equal(git('commit', '-qm', 'init').status, 0);
  put('.wka/state.json', JSON.stringify({ flow: 6, step: 2, history: [] }));
  put('.wka/decisions.json', JSON.stringify({ version: 1, delivery: { status: 'confirmed', value: 'video', source: '用户确认' } }));
  return { dir, git, put };
}
function run(dir, note, decision = 'approved', approval = null) {
  const logs = [];
  return reviewCommands({ pos: [dir, note], opt: key => key === 'step' ? '3' : key === 'decision' ? decision : key === 'approval-id' ? approval : null, log: message => logs.push(message), aspectOpt: () => null }).signoff();
}
function state(dir) { return JSON.parse(fs.readFileSync(path.join(dir, '.wka/state.json'), 'utf8')); }

test('an unrelated change blocks approval before progress changes', async t => {
  const { dir, git, put } = film(t);
  put('story.md', '新剧本');
  put('other.md', '无关改动');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  await assert.rejects(run(dir, '进入'), /范围之外/);
  assert.equal(git('rev-parse', 'HEAD').stdout.trim(), head);
  assert.equal(state(dir).step, 2);
  assert.equal(state(dir).history.length, 0);
});

test('a failed commit does not advance the stage', async t => {
  const { dir, git, put } = film(t);
  put('story.md', '新剧本');
  const hooks = path.join(dir, '.git', 'hooks');
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.equal(git('config', 'core.hooksPath', hooks).status, 0);
  await assert.rejects(run(dir, '进入'), /提交失败/);
  assert.equal(state(dir).step, 2);
});

test('approval commits the story and advances past excluded steps', async t => {
  const { dir, git, put } = film(t);
  put('story.md', '新剧本');
  await run(dir, '进入编写剧本');
  assert.match(git('show', '--name-only', '--pretty=format:', 'HEAD~1').stdout, /story\.md/);
  assert.equal(state(dir).step, 4);
  assert.equal(state(dir).history.at(-1).decision, 'approved');
});

test('a repair records the decision without advancing or allowing the same commit later', async t => {
  const { dir, git, put } = film(t);
  put('story.md', '新剧本');
  await run(dir, '改开场', 'changes-requested', 'repair-1');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  assert.equal(state(dir).step, 2);
  assert.equal(state(dir).history.at(-1).decision, 'changes-requested');
  await assert.rejects(run(dir, '改为进入', 'approved', 'repair-2'), /重新提交/);
  assert.equal(git('rev-parse', 'HEAD').stdout.trim(), head);
});
