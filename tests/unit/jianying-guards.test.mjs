import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freeDraftName, jianyingRunning } from '../../plugin/engine/exporters/jianying/guards.mjs';

const root = (...taken) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-jyname-'));
  for (const n of taken) fs.mkdirSync(path.join(dir, n));
  return dir;
};

test('a free name is used as it is', () => {
  assert.equal(freeDraftName(root(), '春晓'), '春晓');
});

test('a taken name gets _v2, then _v3', () => {
  assert.equal(freeDraftName(root('春晓'), '春晓'), '春晓_v2');
  assert.equal(freeDraftName(root('春晓', '春晓_v2'), '春晓'), '春晓_v3');
});

test('the first free version is used, even when a later one exists', () => {
  assert.equal(freeDraftName(root('春晓', '春晓_v3'), '春晓'), '春晓_v2');
});

test('every version up to _v99 taken is an error', () => {
  const dir = root('春晓', ...Array.from({ length: 98 }, (_, i) => `春晓_v${i + 2}`));
  assert.throws(() => freeDraftName(dir, '春晓'), /99 份《春晓》/);
});

test('jianyingRunning follows WKA_JIANYING_PROCESS', () => {
  const old = process.env.WKA_JIANYING_PROCESS;
  try {
    process.env.WKA_JIANYING_PROCESS = path.basename(process.execPath);
    assert.equal(jianyingRunning(), process.platform === 'darwin');
    process.env.WKA_JIANYING_PROCESS = 'wka-no-such-process';
    assert.equal(jianyingRunning(), false);
  } finally {
    if (old === undefined) delete process.env.WKA_JIANYING_PROCESS;
    else process.env.WKA_JIANYING_PROCESS = old;
  }
});
