import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const serverUrl = new URL('../../plugin/engine/cli/workbench-server.mjs', import.meta.url);
async function fixture(t) {
  assert.ok(fs.existsSync(serverUrl), '本地工作台服务尚未实现');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-http-')), film = path.join(root, 'films', '测试 片');
  fs.mkdirSync(film, { recursive: true }); fs.writeFileSync(path.join(film, 'brief.md'), '# 审阅内容\n需要保留');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { startWorkbench } = await import(serverUrl);
  const server = await startWorkbench(root);
  t.after(() => server.close());
  const headers = { Authorization: 'Bearer ' + server.token, 'Content-Type': 'application/json', Origin: server.origin };
  const request = (route, body) => fetch(server.origin + route, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const listing = await (await request('/api/films')).json();
  const id = listing.films[0].id;
  return { root, film, server, headers, request, id };
}
test('loopback UI serves only registered immutable files with range support and rejects foreign requests', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.server.origin + '/')).status, 200);
  for (const name of ['model', 'document', 'session']) {
    const module = await fetch(f.server.origin + '/' + name + '.mjs');
    assert.equal(module.status, 200); assert.match(module.headers.get('content-type'), /javascript/);
    assert.match(await module.text(), /export /);
  }
  assert.equal((await fetch(f.server.origin + '/api/films')).status, 401);
  assert.equal((await fetch(f.server.origin + '/api/films', { headers: { ...f.headers, Origin: 'https://evil.example' } })).status, 403);
  const view = await (await f.request('/api/report?film=' + f.id)).json(), item = view.stages.find(s => s.step === 2).items[0];
  const file = `/api/file?film=${f.id}&artifact=${item.id}&version=${item.current.id}`;
  const range = await fetch(f.server.origin + file, { headers: { ...f.headers, Range: 'bytes=0-4' } });
  assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 5);
  assert.equal((await fetch(f.server.origin + file, { headers: { ...f.headers, Range: 'bytes=99999-' } })).status, 416);
  assert.equal((await f.request('/api/file?film=' + f.id + '&artifact=../../etc/passwd&version=unknown')).status, 400);
  assert.equal((await f.request('/api/report?film=../../')).status, 400);
  assert.equal(fs.readFileSync(path.join(f.film, 'brief.md'), 'utf8'), '# 审阅内容\n需要保留');
});
test('real review handler signs off a checked brief and persists feedback without generating media', async t => {
  const f = await fixture(t);
  const view = await (await f.request('/api/report?film=' + f.id)).json(), stage = view.stages.find(s => s.step === 2), item = stage.items[0];
  let response = await f.request('/api/check', { film: f.id, artifactId: item.id, versionId: item.current.id, revision: item.revision });
  assert.equal(response.status, 200);
  response = await f.request('/api/decision', { film: f.id, step: 2, revision: stage.revision, decision: 'approved', note: '明确通过此简报' });
  assert.equal(response.status, 200, await response.text());
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.film, '.wka/state.json'))).history.at(-1).step, 2);
  response = await f.request('/api/note', { film: f.id, artifactId: item.id, versionId: item.current.id, text: '补一句目标', anchor: { type: 'general' } });
  assert.equal(response.status, 200);
  const pending = await (await f.request('/api/pending?film=' + f.id)).json();
  assert.equal(pending.notes[0].text, '补一句目标');
  assert.equal(fs.readdirSync(f.film).some(file => file.endsWith('.mp4')), false);
});
test('CLI capture and pending work from a copied plugin without opening a server', async t => {
  const f = await fixture(t);
  const repository = fileURLToPath(new URL('../../', import.meta.url)), copy = path.join(f.root, 'portable');
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'plugin'], { cwd: repository, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const rel of files) { const dest = path.join(copy, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(repository, rel), dest); }
  const run = args => spawnSync(process.execPath, [path.join(copy, 'plugin/engine/bin/wka.mjs'), ...args], { cwd: f.root, encoding: 'utf8', timeout: 10000 });
  const capture = run(['workbench', f.film, '--capture']);
  assert.equal(capture.status, 0, capture.stderr);
  assert.equal(JSON.parse(capture.stdout).stages.length, 15);
  const pending = run(['workbench', f.film, '--pending']);
  assert.equal(pending.status, 0, pending.stderr); assert.ok(Array.isArray(JSON.parse(pending.stdout).notes));
});

test('an archive failure prevents an enrolled CLI command from signing off', async t => {
  const f = await fixture(t);
  const view = await (await f.request('/api/report?film=' + f.id)).json(), item = view.stages.find(s => s.step === 2).items[0];
  const object = path.join(f.film, '.wka/workbench/objects', item.current.snapshot.entries[0].sha256);
  fs.writeFileSync(object, 'damaged history');
  const cli = fileURLToPath(new URL('../../plugin/engine/bin/wka.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'signoff', f.film, '不应批准', '--step', '2'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /快照损坏/);
  assert.equal(fs.existsSync(path.join(f.film, '.wka/state.json')), false);
  assert.equal(fs.existsSync(path.join(f.film, '.cache/operation.lock')), false);
});

test('UI drafts and status use authenticated routes and restore across server instances', async t => {
  const f = await fixture(t);
  let r = await f.request('/api/ui'); assert.equal(r.status, 200, '缺少本机草稿读取路由');
  r = await f.request('/api/ui', { key: 'note:test:a:v1', expected: 0, value: { text: '未提交草稿' } });
  assert.equal(r.status, 200); assert.equal((await r.json()).revision, 1);
  assert.equal((await f.request('/api/ui', { key: 'note:test:a:v1', expected: 0, value: null })).status, 400);
  assert.equal((await fetch(f.server.origin + '/api/ui')).status, 401);
  const { startWorkbench } = await import(serverUrl), second = await startWorkbench(f.root); t.after(() => second.close());
  const value = await (await fetch(second.origin + '/api/ui', { headers: { Authorization: 'Bearer ' + second.token } })).json();
  assert.equal(value.entries['note:test:a:v1'].value.text, '未提交草稿');
  const status = await (await f.request('/api/status?film=' + f.id)).json();
  assert.equal(status.busy, false); assert.equal(typeof status.revision, 'string');
  assert.equal(fs.existsSync(path.join(f.film, '.wka/state.json')), false);
});

test('CLI repair records an existing new version and HTTP user verification closes it', async t => {
  const f = await fixture(t), initial = await (await f.request('/api/report?film=' + f.id)).json();
  let item = initial.stages.find(s => s.step === 2).items[0];
  const note = await (await f.request('/api/note', { film: f.id, artifactId: item.id, versionId: item.current.id, text: '补全受众', requestId: 'http-repair-note' })).json();
  fs.writeFileSync(path.join(f.film, 'brief.md'), '面向初次制作的创作者');
  item = (await (await f.request('/api/report?film=' + f.id)).json()).stages.find(s => s.step === 2).items[0];
  const cli = fileURLToPath(new URL('../../plugin/engine/bin/wka.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [cli, 'workbench', f.film, '--repair', note.id, '--version', item.current.id, '--summary', '补全受众', '--verification', '已逐字核对'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, r.stderr); const repaired = JSON.parse(r.stdout); assert.equal(repaired.status, 'awaiting-review');
  const response = await f.request('/api/resolve', { film: f.id, id: note.id, action: 'verified', repairId: repaired.repair.id });
  assert.equal(response.status, 200, await response.text());
  assert.equal((await (await f.request('/api/pending?film=' + f.id)).json()).notes.length, 0);
});
