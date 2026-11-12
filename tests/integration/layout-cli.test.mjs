// 影片目录布局 v7 的命令行行为：素材导入、目录占用、深度清理。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../../plugin/engine/cli/run.mjs';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';

async function cli(args) {
  const log = [], error = [];
  const code = await runCli(args, { log: text => log.push(text), error: text => error.push(text) });
  return { code, out: log.join('\n'), err: error.join('\n') };
}

function film(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-layout-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'films', '测试片');
  fs.mkdirSync(dir, { recursive: true });
  initializeProduction(dir);
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify({ title: '测试片', style: 'ink-wash', size: [320, 180], fps: 10, seed: 1, shots: [] }));
  return { root, dir };
}

test('materials --add 按类型导入并写来源，重复导入跳过', async t => {
  const { root, dir } = film(t);
  const source = path.join(root, '来料');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, '说明.md'), '# 资料');
  fs.writeFileSync(path.join(source, '图.png'), Buffer.from('not-really-png'));
  const first = await cli(['materials', dir, '--add', source, '--frames', '0']);
  assert.equal(first.code, 0, first.err);
  assert.ok(fs.existsSync(path.join(dir, '资料', '说明.md')));
  assert.ok(fs.existsSync(path.join(dir, 'review', '素材', '素材清单.md')));
  const origin = JSON.parse(fs.readFileSync(path.join(dir, '.wka', 'materials-origin.json'), 'utf8'));
  assert.ok(Object.keys(origin.files).length >= 1);
  const again = await cli(['materials', dir, '--add', source, '--frames', '0']);
  assert.equal(again.code, 0, again.err);
  assert.equal(fs.readdirSync(path.join(dir, '资料')).filter(name => name.startsWith('说明')).length, 1);
  assert.notEqual((await cli(['materials', dir, '--add'])).code, 0);
});

test('status 显示目录占用；clean --deep 先列清单，加 --yes 才删缓存且保留成片', async t => {
  const { root, dir } = film(t);
  fs.mkdirSync(path.join(dir, '.cache', '16x9', 'segments'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.cache', '16x9', 'segments', 's01.mp4'), Buffer.alloc(4096));
  fs.writeFileSync(path.join(dir, '.cache', 'render-speed.json'), 'keep');
  fs.mkdirSync(path.join(dir, '成片'), { recursive: true });
  fs.writeFileSync(path.join(dir, '成片', '测试片-16x9.mp4'), 'final');
  const status = await cli(['status', root]);
  assert.match(status.out, /占用：.*\.cache/);

  const dry = await cli(['clean', dir, '--deep']);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /--yes/);
  assert.ok(fs.existsSync(path.join(dir, '.cache', '16x9')));

  const done = await cli(['clean', dir, '--deep', '--yes']);
  assert.equal(done.code, 0, done.err);
  assert.equal(fs.existsSync(path.join(dir, '.cache', '16x9')), false);
  assert.ok(fs.existsSync(path.join(dir, '.cache', 'render-speed.json')));
  assert.equal(fs.readFileSync(path.join(dir, '成片', '测试片-16x9.mp4'), 'utf8'), 'final');
});
