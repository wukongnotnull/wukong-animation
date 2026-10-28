// wka 未知命令要以非 0 退出，脚本和 CI 才能发现命令打错（#66）；查看帮助仍正常退出。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WKA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugin/engine/bin/wka.mjs');
const wka = (...args) => spawnSync(process.execPath, [WKA, ...args], { encoding: 'utf8' });

test('未知命令：stderr 提示并打印帮助，退出码 1', () => {
  const r = wka('rendr');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /未知命令 "rendr"/);
  assert.match(r.stderr, /wka init/);
});

test('不带参数、help、--help：打印帮助，退出码 0', () => {
  for (const args of [[], ['help'], ['--help']]) {
    const r = wka(...args);
    assert.equal(r.status, 0, args.join(' '));
    assert.match(r.stdout, /wka init/);
  }
});
