import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ShotCache } from '../../plugin/engine/core/cache.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-shot-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cache = new ShotCache(dir);
  const file = cache.segmentPath('s01', 'old');
  fs.writeFileSync(file, 'old segment');
  cache.store('s01', 'old', file);
  return { dir, cache, file };
}

test('damaged manifests warn and rebuild without deleting paths from invalid entries', (t) => {
  const { dir, cache, file } = fixture(t);
  const protectedFile = path.join(dir, 'source.txt');
  fs.writeFileSync(protectedFile, 'keep');
  for (const text of ['', '{"shots":', 'null', '[]', '{}', '{"shots":[]}', '{"shots":{"s01":null}}',
    JSON.stringify({ shots: { s01: { file: protectedFile, hash: null } } })]) {
    fs.writeFileSync(cache.file, text);
    const logs = [];
    const reopened = new ShotCache(dir, cache.dir, { log: message => logs.push(message) });
    assert.equal(reopened.lookup('s01', 'old'), null);
    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes(cache.file));
    assert.match(logs[0], /缓存索引失效.*重新生成/);
    reopened.store('s01', 'old', file);
    assert.equal(new ShotCache(dir).lookup('s01', 'old'), file);
    assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'keep');
  }
});

test('valid caches reuse entries, replace only the old segment, and persist invalidation', (t) => {
  const { dir, cache, file } = fixture(t);
  const fresh = cache.segmentPath('s01', 'new');
  fs.writeFileSync(fresh, 'new segment');
  const other = cache.segmentPath('s02', 'other');
  fs.writeFileSync(other, 'other segment');
  cache.store('s02', 'other', other);
  assert.equal(new ShotCache(dir).lookup('s01', 'old'), file);
  cache.store('s01', 'new', fresh);
  assert.equal(fs.existsSync(file), false);
  assert.equal(new ShotCache(dir).lookup('s01', 'new'), fresh);
  cache.invalidate('s01');
  const reopened = new ShotCache(dir);
  assert.equal(reopened.lookup('s01', 'new'), null);
  assert.equal(reopened.lookup('s02', 'other'), other);
});

for (const operation of ['store', 'invalidate']) for (const failure of ['write', 'rename']) {
  test(`${operation}: interrupted ${failure} keeps the previous manifest and cache hit`, (t) => {
    const { dir, cache, file } = fixture(t);
    const before = fs.readFileSync(cache.file);
    const fresh = cache.segmentPath('s01', 'new');
    fs.writeFileSync(fresh, 'new segment');
    const error = Object.assign(new Error('injected save failure'), { code: 'ENOSPC' });
    if (failure === 'write') {
      const write = fs.writeFileSync;
      t.mock.method(fs, 'writeFileSync', (target, ...args) => {
        if (String(target).startsWith(cache.file)) {
          write(target, '{'); // 模拟写了一部分后失败，不能只在写入前抛错。
          throw error;
        }
        return write(target, ...args);
      });
    } else {
      const rename = fs.renameSync;
      t.mock.method(fs, 'renameSync', (from, to) => {
        if (to === cache.file) throw error;
        return rename(from, to);
      });
    }
    assert.throws(() => operation === 'store' ? cache.store('s01', 'new', fresh) : cache.invalidate('s01'), error);
    assert.deepEqual(fs.readFileSync(cache.file), before);
    assert.equal(cache.lookup('s01', 'old'), file, 'failed save must not publish the in-memory change');
    assert.equal(new ShotCache(dir).lookup('s01', 'old'), file);
    assert.equal(fs.readFileSync(file, 'utf8'), 'old segment');
    assert.equal(fs.readdirSync(cache.dir).some(name => name.endsWith('.part')), false);
  });
}

test('manifest read permission errors propagate instead of becoming an empty cache', (t) => {
  const { dir, cache } = fixture(t);
  const read = fs.readFileSync, logs = [];
  const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (file === cache.file) throw error;
    return read(file, ...args);
  });
  assert.throws(() => new ShotCache(dir, cache.dir, { log: message => logs.push(message) }), error);
  assert.deepEqual(logs, []);
});

test('missing manifest starts empty but a manifest directory is an access failure', (t) => {
  const { dir, cache } = fixture(t);
  fs.unlinkSync(cache.file);
  assert.equal(new ShotCache(dir).lookup('s01', 'old'), null);
  fs.mkdirSync(cache.file);
  assert.throws(() => new ShotCache(dir), { code: 'EISDIR' });
});
