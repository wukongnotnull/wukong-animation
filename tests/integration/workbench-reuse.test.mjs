import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';

const cli = fileURLToPath(new URL('../../plugin/engine/bin/wka.mjs', import.meta.url));
const service = new URL('../../plugin/engine/cli/workbench-service.mjs', import.meta.url);
async function manager() { assert.ok(fs.existsSync(service), '缺少自动复用服务协调器'); return import(service); }
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-reuse-'))), home = path.join(root, 'home');
  const films = ['甲', '乙', '丙'].map(name => { const dir = path.join(root, name); fs.mkdirSync(dir); initializeProduction(dir); fs.writeFileSync(path.join(dir, 'brief.md'), '# ' + name); return dir; });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, home, films, env: { ...process.env, WUKONG_ANIMATION_HOME: home } };
}
async function port() { const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value; }
async function listing(app) { return (await fetch(app.origin + '/api/films', { headers: { 'Sec-Fetch-Site': 'same-origin', Connection: 'close' } })).json(); }
function child(t, f, args) {
  const process = spawn(globalThis.process.execPath, [cli, 'workbench', ...args], { env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  process.stdout.on('data', data => { output += data; }); process.stderr.on('data', data => { output += data; });
  const exit = once(process, 'exit').then(([code]) => ({ code, output }));
  const url = new Promise((resolve, reject) => { process.stdout.on('data', () => { const match = /http:\/\/127\.0\.0\.1:\d+\/\S*/.exec(output); if (match) resolve(match[0]); }); process.once('error', reject); process.once('exit', () => reject(new Error(output))); });
  url.catch(() => {});
  const stop = async () => { if (process.exitCode === null && process.signalCode === null) { process.kill(); await exit; } };
  t.after(stop); return { process, exit, url, stop };
}
test('a second real CLI invocation joins the running port and exits without restarting its owner', { timeout: 10000 }, async t => {
  const f = fixture(t), first = child(t, f, [f.films[0], '--port', String(await port())]);
  const original = new URL(await first.url), second = child(t, f, [f.films[1]]);
  let timer;
  const result = await Promise.race([second.exit, new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), 2500); })]);
  clearTimeout(timer); assert.equal(result.timedOut, undefined, '后续命令应接入已有服务后退出'); assert.equal(result.code, 0, result.output);
  assert.equal(new URL(await second.url).origin, original.origin);
  assert.equal(first.process.exitCode, null);
  const rows = await listing({ origin: original.origin }); assert.equal(rows.films.length, 2);
  assert.equal(new URL(await second.url).searchParams.get('film'), rows.films.find(film => film.dir === f.films[1]).id);
});
test('registration is atomic and idempotent and survives a same-port service restart', async t => {
  const f = fixture(t), { openWorkbench } = await manager();
  let app = await openWorkbench(f.films[0], { home: f.home, port: await port() }); t.after(() => app.close());
  const initial = await listing(app), origin = app.origin;
  const reused = await openWorkbench(f.films[1], { home: f.home }); assert.equal(reused.reused, true); assert.equal(reused.origin, origin);
  await openWorkbench(f.films[1], { home: f.home });
  await assert.rejects(openWorkbench(f.films[2], { home: f.home, directories: [path.join(f.root, 'missing')] }));
  const before = await listing(app); assert.equal(before.films.length, 2); assert.equal(before.films[0].id, initial.films[0].id);
  await app.close(); app = await openWorkbench(f.films[1], { home: f.home });
  assert.equal(app.origin, origin); assert.deepEqual(await listing(app), before);
  const registry = path.join(f.home, 'workbench');
  if (process.platform !== 'win32') { assert.equal(fs.statSync(registry).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(registry, 'runtime.json')).mode & 0o777, 0o600); }
});
test('concurrent starters share one owner and register every project', async t => {
  const f = fixture(t), { openWorkbench } = await manager(), chosen = await port();
  const apps = await Promise.all(f.films.map(dir => openWorkbench(dir, { home: f.home, port: chosen })));
  const owner = apps.find(app => !app.reused); t.after(() => owner.close());
  assert.equal(apps.filter(app => !app.reused).length, 1); assert.equal(new Set(apps.map(app => app.origin)).size, 1);
  assert.equal((await listing(owner)).films.length, 3);
});
test('control registration rejects browser requests and credentials are absent from public APIs', async t => {
  const f = fixture(t), { openWorkbench } = await manager(), app = await openWorkbench(f.films[0], { home: f.home, port: await port() }); t.after(() => app.close());
  const runtime = JSON.parse(fs.readFileSync(path.join(f.home, 'workbench/runtime.json')));
  for (const headers of [{}, { 'X-Wka-Control': 'wrong' }, { 'X-Wka-Control': runtime.token, Origin: app.origin }, { 'X-Wka-Control': runtime.token, 'Sec-Fetch-Site': 'same-origin' }, { 'X-Wka-Control': runtime.token, Origin: 'https://example.org', 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await fetch(app.origin + '/_workbench/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ directories: [f.films[1]] }) });
    assert.equal(response.status, 403); assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  const data = await listing(app); assert.equal(data.films.length, 1); assert.equal(JSON.stringify(data).includes(runtime.token), false); assert.equal(app.url.includes(runtime.token), false);
});
test('archive-first shared workbench can save new-film drafts without writing archive state', async t => {
  const f = fixture(t), { openWorkbench } = await manager(); fs.rmSync(path.join(f.films[0], '.wka/state.json'));
  const app = await openWorkbench(f.films[0], { home: f.home, port: await port() }); t.after(() => app.close()); await openWorkbench(f.films[1], { home: f.home });
  const id = (await listing(app)).films.find(film => film.dir === f.films[1]).id;
  const response = await fetch(app.origin + '/api/ui', { method: 'POST', headers: { Origin: app.origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'position:' + id, expected: 0, value: { overview: true } }) });
  assert.equal(response.status, 200, await response.text()); assert.equal(fs.existsSync(path.join(f.films[0], '.wka/workbench-local')), false);
});
test('foreign occupied ports and corrupt catalogues are preserved without registration requests', async t => {
  const f = fixture(t), { openWorkbench } = await manager(), calls = [];
  const foreign = http.createServer((req, res) => { calls.push(req.url); res.end('{}'); }); await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => foreign.close(resolve)));
  await assert.rejects(openWorkbench(f.films[0], { home: f.home, port: foreign.address().port }), /EADDRINUSE|占用/); assert.deepEqual(calls, []);
  const catalog = path.join(f.home, 'workbench/catalog.json'); fs.writeFileSync(catalog, '{broken');
  await assert.rejects(openWorkbench(f.films[0], { home: f.home }), /记录|清单/); assert.equal(fs.readFileSync(catalog, 'utf8'), '{broken');
});
test('stale runtime identity cannot send new project paths to a replacement server', async t => {
  const f = fixture(t), { openWorkbench } = await manager(); const app = await openWorkbench(f.films[0], { home: f.home, port: await port() });
  const runtimePath = path.join(f.home, 'workbench/runtime.json'), runtime = fs.readFileSync(runtimePath); await app.close();
  const calls = [], foreign = http.createServer((req, res) => { calls.push(req.url); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ service: 'wka-workbench', protocol: 1, instanceId: 'different' })); });
  await new Promise(resolve => foreign.listen(Number(new URL(app.origin).port), '127.0.0.1', resolve)); t.after(() => new Promise(resolve => foreign.close(resolve))); fs.writeFileSync(runtimePath, runtime);
  await assert.rejects(openWorkbench(f.films[1], { home: f.home }), /身份|连接|响应/); assert.deepEqual(calls, ['/_workbench/status']);
  assert.equal(fs.readFileSync(runtimePath, 'utf8'), runtime.toString());
});
test('a killed owner and its stale startup lock recover on the same port with previous projects', { timeout: 10000 }, async t => {
  const f = fixture(t), first = child(t, f, [f.films[0], '--port', String(await port())]);
  const origin = new URL(await first.url).origin; first.process.kill('SIGKILL'); await first.exit;
  fs.writeFileSync(path.join(f.home, 'workbench/startup.lock'), JSON.stringify({ pid: first.process.pid, id: 'stale-owner' }));
  const second = child(t, f, [f.films[1]]); assert.equal(new URL(await second.url).origin, origin);
  assert.equal((await listing({ origin })).films.length, 2);
});
test('an unavailable remembered project does not block restart or change remaining film identities', async t => {
  const f = fixture(t), { openWorkbench } = await manager();
  let app = await openWorkbench(f.films[0], { home: f.home, port: await port(), directories: [f.films[1]] }); t.after(() => app.close());
  const before = await listing(app); await app.close(); fs.rmSync(f.films[0], { recursive: true });
  app = await openWorkbench(f.films[1], { home: f.home }); const after = await listing(app);
  assert.equal(after.workspaceId, before.workspaceId); assert.deepEqual(after.films, before.films.slice(1));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.home, 'workbench/catalog.json'))).directories.length, 2);
});
test('a project with a forbidden films symlink cannot poison the running catalogue', async t => {
  const f = fixture(t), { openWorkbench } = await manager();
  const app = await openWorkbench(f.films[0], { home: f.home, port: await port() }); t.after(() => app.close());
  const before = await listing(app), catalogPath = path.join(f.home, 'workbench/catalog.json'), catalogue = fs.readFileSync(catalogPath, 'utf8');
  fs.symlinkSync(f.films[1], path.join(f.films[2], 'films'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(openWorkbench(f.films[2], { home: f.home }), /链接/);
  assert.deepEqual(await listing(app), before); assert.equal(fs.readFileSync(catalogPath, 'utf8'), catalogue);
});
