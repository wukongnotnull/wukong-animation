import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../../plugin/engine/cli/run.mjs';
import { readProgress } from '../../plugin/engine/core/state.mjs';

function project(t, flow = 5) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-flow-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'films', '历史片'); fs.mkdirSync(path.join(dir, '.wka'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.wka/state.json'), JSON.stringify({ flow, step: 2, history: [] }));
  // Deliberately no runnable shots: guard tests never generate media, even before the fix.
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify({ title: '旧片' }));
  return { root, dir };
}
function contents(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .map(e => [e.name, e.isDirectory() ? contents(path.join(dir, e.name)) : fs.readFileSync(path.join(dir, e.name)).toString('base64')]);
}
async function cli(args) { const log = [], error = []; const code = await runCli(args, { log: x => log.push(x), error: x => error.push(x) }); return { code, log, error }; }

for (const flow of [5, 7]) test(`flow ${flow} 所有旧项目制作入口先拒绝，不写锁、执行状态、签批或产物`, async t => {
  const { dir } = project(t, flow), before = contents(dir);
  for (const args of [['render', dir, '--proxy'], ['preview', dir], ['still', dir], ['animatic', dir], ['soundtrack', dir],
    ['audition', dir], ['subtitles', dir], ['final', dir], ['qc', dir], ['clean', dir], ['sfx', dir],
    ['signoff', dir, '不能写入', '--step', '2'], ['delivery', dir, '--final', '--record']]) {
    const result = await cli(args);
    assert.equal(result.code, 1, args[0]); assert.match(result.error.join('\n'), /历史|弃用/, args[0]);
    assert.deepEqual(contents(dir), before, args[0]);
  }
});

test('新简报与初始化共享新身份，补齐影片后仍可按九道流程恢复', async t => {
  const { root } = project(t), dir = path.join(root, 'films', '新片');
  const brief = await cli(['brief', '新片', '--dir', root]); assert.equal(brief.code, 0, brief.error.join('\n'));
  assert.equal(readProgress(dir).flow, 8);
  const init = await cli(['init', '新片', '--style', 'ink-wash', '--dir', root]); assert.equal(init.code, 0, init.error.join('\n'));
  assert.equal(readProgress(dir).flow, 8); assert.equal(readProgress(dir).step, 1);
  const film = JSON.parse(fs.readFileSync(path.join(dir, 'film.json'), 'utf8'));
  assert.notEqual(film.audio?.voice_source, 'ai'); assert.equal(film.subtitles?.mode ?? 'none', 'none');
  const status = await cli(['status', root]); assert.equal(status.code, 0); assert.match(status.log.join('\n'), /历史项目（只读）/); assert.match(status.log.join('\n'), /1\/9/);
});

test('旧片补简报或补影片工程拒绝，原目录保持不变', async t => {
  const { root, dir } = project(t); fs.rmSync(path.join(dir, 'film.json'));
  const before = contents(dir);
  for (const args of [['brief', '历史片', '--dir', root], ['init', '历史片', '--dir', root, '--style', 'ink-wash']]) {
    const result = await cli(args); assert.equal(result.code, 1); assert.match(result.error.join('\n'), /历史/); assert.deepEqual(contents(dir), before);
  }
});

test('查看旧项目恢复信息只说明留档，不生成可执行的续作步骤', async t => {
  const { dir } = project(t), before = contents(dir);
  const result = await cli(['resume', dir, '--json']); assert.equal(result.code, 0);
  const data = JSON.parse(result.log.join('')); assert.equal(data.readonly, true); assert.match(data.next, /新建/);
  assert.deepEqual(contents(dir), before);
});
