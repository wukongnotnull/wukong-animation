import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { buildManifest, writeManifest } from '../../plugin/engine/core/delivery-manifest.mjs';
import { initReviewRepo } from '../helpers/review-repo.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const serverUrl = new URL('../../plugin/engine/cli/workbench-server.mjs', import.meta.url);
async function fixture(t) {
  assert.ok(fs.existsSync(serverUrl), '本地工作台服务尚未实现');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-http-')), film = path.join(root, 'films', '测试 片');
  fs.mkdirSync(film, { recursive: true }); initializeProduction(film); fs.writeFileSync(path.join(film, 'brief.md'), '# 审阅内容\n需要保留');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { startWorkbench } = await import(serverUrl);
  const server = await startWorkbench(root);
  t.after(() => server.close());
  const headers = { 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', Origin: server.origin };
  const request = (route, body) => fetch(server.origin + route, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const listing = await (await request('/api/films')).json();
  const id = listing.films[0].id;
  return { root, film, server, headers, request, id };
}
test('direct address serves films and immutable media without browser credentials', async t => {
  const f = await fixture(t);
  assert.equal(f.server.url, f.server.origin + '/');
  assert.equal(f.server.server.address().address, '127.0.0.1');
  const headers = { 'Sec-Fetch-Site': 'same-origin' };
  const listing = await fetch(f.server.origin + '/api/films', { headers });
  assert.equal(listing.status, 200);
  assert.equal((await listing.json()).films[0].id, f.id);
  const view = await (await fetch(f.server.origin + '/api/report?film=' + f.id, { headers })).json();
  const item = view.stages.find(s => s.step === 2).items[0];
  const file = await fetch(f.server.origin + `/api/file?film=${f.id}&artifact=${item.id}&version=${item.current.id}`, { headers: { ...headers, Range: 'bytes=0-4' } });
  assert.equal(file.status, 206); assert.equal((await file.arrayBuffer()).byteLength, 5);
  assert.equal(file.headers.get('cache-control'), 'no-store');
  assert.match(file.headers.get('content-security-policy'), /sandbox/);
  assert.equal(listing.headers.get('set-cookie'), null);
});
test('HTTP report exposes complete voice recordings in stage four and streams their immutable bytes', async t => {
  const f = await fixture(t), bytes = Buffer.from('complete recording fixture');
  fs.writeFileSync(path.join(f.film, 'full.wav'), bytes);
  fs.writeFileSync(path.join(f.film, 'film.json'), JSON.stringify({ audio: { voice_source: 'user', voices: [{ cue: 'v1', file: 'full.wav', at: 0, text: '原稿' }] } }));
  fs.mkdirSync(path.join(f.film, 'review/台词'), { recursive: true });
  fs.writeFileSync(path.join(f.film, 'review/台词/台词定位.md'), '# 录音内句段');
  fs.writeFileSync(path.join(f.film, 'review/台词/逐词时间表.md'), '# 可选参考');
  const report = await (await f.request('/api/report?film=' + f.id)).json(), stage = report.stages.find(s => s.step === 4);
  assert.equal(report.stages.length, 9);
  const recording = stage.items.find(i => i.relativePath === 'full.wav');
  assert.equal(recording.required, true); assert.equal(recording.kind, 'audio');
  assert.equal(stage.items.find(i => i.relativePath.endsWith('台词定位.md')).required, true);
  assert.equal(stage.items.find(i => i.relativePath.endsWith('逐词时间表.md')).required, false);
  fs.writeFileSync(path.join(f.film, 'full.wav'), 'later replacement');
  const response = await f.request(`/api/file?film=${f.id}&artifact=${recording.id}&version=${recording.current.id}`);
  assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test('source checks reject foreign or missing metadata and cannot be bypassed by legacy tokens', async t => {
  const f = await fixture(t), valid = { Origin: f.server.origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };
  const invalid = [
    {}, { 'Sec-Fetch-Site': 'none' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'cross-site' },
    { Origin: f.server.origin }, { ...valid, Origin: 'null' },
    { ...valid, Origin: 'http://127.0.0.1:1' }, { ...valid, Origin: 'https://evil.example' },
    { ...valid, Origin: 'http://127.0.0.1/' }, { ...valid, Origin: 'https://127.0.0.1' },
    { ...valid, 'Sec-Fetch-Site': 'cross-site', Authorization: 'Bearer legacy-token' },
  ];
  for (const headers of invalid) {
    const response = await fetch(f.server.origin + '/api/films?token=legacy-token', { headers });
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  // fetch normalizes Host; raw HTTP proves the server rejects rebinding/aliases.
  for (const host of ['evil.example', 'localhost:' + new URL(f.server.origin).port]) for (const origin of [f.server.origin, 'http://127.0.0.1']) {
    const status = await new Promise((resolve, reject) => {
      http.get(f.server.origin + '/api/films', { headers: { ...valid, Origin: origin, Host: host } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      }).on('error', reject);
    });
    assert.equal(status, 403, host);
  }
  const writeHeaders = [
    { 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
    { ...valid, 'Sec-Fetch-Site': 'cross-site' }, { ...valid, Origin: 'https://evil.example' },
  ];
  for (const headers of writeHeaders) {
    const response = await fetch(f.server.origin + '/api/ui', { method: 'POST', headers, body: JSON.stringify({ key: 'film', expected: 0, value: 'unwanted' }) });
    assert.equal(response.status, 403);
  }
  assert.equal((await fetch(f.server.origin + '/api/ui', { method: 'POST', headers: { ...valid, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'key=film&value=unwanted' })).status, 400);
  const preflight = await fetch(f.server.origin + '/api/ui', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.status, 403); assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  assert.equal(fs.existsSync(path.join(f.root, '.wka/workbench-local/state.json')), false);
  assert.equal(fs.readFileSync(path.join(f.film, 'brief.md'), 'utf8'), '# 审阅内容\n需要保留');
});
test('restarting the same local address needs no new credentials and other ports remain foreign', async t => {
  const f = await fixture(t), { startWorkbench } = await import(serverUrl);
  let second = await startWorkbench(f.root);
  t.after(() => second.close());
  const origin = second.origin, headers = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', Connection: 'close' };
  assert.equal((await fetch(origin + '/api/films', { headers })).status, 200);
  assert.equal((await fetch(origin + '/api/films', { headers: { ...headers, Origin: f.server.origin } })).status, 403);
  await second.close();
  second = await startWorkbench(f.root, { port: Number(new URL(origin).port) });
  assert.equal(second.origin, origin);
  assert.equal((await fetch(origin + '/api/films', { headers })).status, 200);
});
test('page keeps a light and dark theme switch in the browser', async t => {
  const f = await fixture(t);
  const headers = { 'Sec-Fetch-Site': 'same-origin', Origin: f.server.origin };
  const html = await (await fetch(f.server.origin + '/', { headers })).text();
  const pluginVersion = JSON.parse(fs.readFileSync(new URL('../../plugin/plugin.json', import.meta.url), 'utf8')).version.replaceAll('.', '\\.');
  assert.match(html, new RegExp(`id="plugin-version"[^>]*>审阅工作台<span class="rev">v${pluginVersion}</span><`));
  assert.match(html, /data-theme-choice="light"/);
  assert.match(html, /data-theme-choice="dark"/);
  assert.match(html, /src="\/theme\.js"/);
  const boot = await (await fetch(f.server.origin + '/theme.js', { headers })).text();
  assert.match(boot, /wka-workbench-theme/);
  const css = await (await fetch(f.server.origin + '/app.css', { headers })).text();
  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /--on-accent:/);
  const js = await (await fetch(f.server.origin + '/app.js', { headers })).text();
  assert.match(js, /function applyTheme/);
});
test('file and review columns are hidden only by the user, never by window width', async t => {
  const f = await fixture(t);
  const html = await (await fetch(f.server.origin + '/', { headers: f.headers })).text();
  assert.doesNotMatch(html, /data-panel/, '不再提供按窗口宽度切换的面板按钮');
  for (const id of ['toggle-library', 'toggle-inspector', 'library-width', 'inspector-width']) assert.match(html, new RegExp(`id="${id}"`));
  const css = await (await fetch(f.server.origin + '/app.css', { headers: f.headers })).text();
  const rules = [];
  for (const media of css.matchAll(/@media[^{]*\{/g)) {
    let depth = 1, end = media.index + media[0].length;
    while (depth && end < css.length) { if (css[end] === '{') depth++; else if (css[end] === '}') depth--; end++; }
    for (const rule of css.slice(media.index + media[0].length, end - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push({ selector: rule[1], body: rule[2] });
  }
  assert.ok(rules.length > 10, '应能读到窄窗规则');
  const columns = /\.workspace|\.library|\.inspector(?![-\w])|#toggle-library|#toggle-inspector|\.layout-controls/;
  const byWidth = rules.filter(rule => columns.test(rule.selector) && /(^|;)\s*(display|grid-template-columns)\s*:/.test(rule.body));
  assert.deepEqual(byWidth.map(rule => rule.selector), [], '窗口宽度不得决定两侧栏和收起按钮是否显示');
});
test('Chrome normalized loopback Origin works for assets, media and JSON review writes', async t => {
  const f = await fixture(t), headers = { ...f.headers, Origin: 'http://127.0.0.1' };
  for (const route of ['/app.css', '/app.js', '/theme.js', '/model.mjs', '/document.mjs', '/session.mjs']) {
    const response = await fetch(f.server.origin + route, { headers });
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /text\/(css|javascript)/);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    await response.arrayBuffer();
  }
  const listing = await fetch(f.server.origin + '/api/films', { headers });
  assert.equal(listing.status, 200); assert.equal((await listing.json()).films[0].id, f.id);
  const report = await (await fetch(f.server.origin + '/api/report?film=' + f.id, { headers })).json();
  const item = report.stages.find(s => s.step === 2).items[0];
  const file = await fetch(f.server.origin + `/api/file?film=${f.id}&artifact=${item.id}&version=${item.current.id}`, { headers: { ...headers, Range: 'bytes=0-4' } });
  assert.equal(file.status, 206); assert.equal((await file.arrayBuffer()).byteLength, 5);
  const note = { film: f.id, artifactId: item.id, versionId: item.current.id, text: 'Chrome 同源意见', anchor: { type: 'general' } };
  const response = await fetch(f.server.origin + '/api/note', { method: 'POST', headers, body: JSON.stringify(note) });
  assert.equal(response.status, 200, await response.text());
  assert.equal((await (await f.request('/api/pending?film=' + f.id)).json()).notes[0].text, note.text);
  assert.equal((await fetch(f.server.origin + '/api/ui', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 400);
});
test('Chrome normalized Origin never admits foreign, navigation or missing Fetch Metadata', async t => {
  const f = await fixture(t);
  for (const site of [undefined, 'none', 'same-site', 'cross-site']) {
    const headers = { Origin: 'http://127.0.0.1', 'Content-Type': 'application/json', ...(site ? { 'Sec-Fetch-Site': site } : {}) };
    for (const route of ['/app.css', '/app.js', '/api/films', '/api/file?token=legacy-token']) {
      const response = await fetch(f.server.origin + route, { headers });
      assert.equal(response.status, 403, `${site}: ${route}`);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
    assert.equal((await fetch(f.server.origin + '/api/ui', { method: 'POST', headers, body: JSON.stringify({ key: 'film', expected: 0, value: 'unwanted' }) })).status, 403);
  }
  assert.equal(fs.existsSync(path.join(f.root, '.wka/workbench-local/state.json')), false);
});
test('loopback UI serves only registered immutable files with range support and rejects foreign requests', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.server.origin + '/')).status, 200);
  for (const name of ['model', 'document', 'session']) {
    const module = await fetch(f.server.origin + '/' + name + '.mjs');
    assert.equal(module.status, 200); assert.match(module.headers.get('content-type'), /javascript/);
    assert.match(await module.text(), /export /);
  }
  assert.equal((await fetch(f.server.origin + '/api/films')).status, 403);
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
  initReviewRepo(f.film);
  fs.appendFileSync(path.join(f.film, '.gitignore'), '.wka/workbench.json\n.wka/workbench/\n');
  const ignore = spawnSync('git', ['commit', '-qam', 'ignore workbench ledger'], { cwd: f.film, encoding: 'utf8' });
  assert.equal(ignore.status, 0, ignore.stderr);
  writeManifest(f.film, buildManifest(f.film, 2));
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
  assert.equal(JSON.parse(capture.stdout).stages.length, 9);
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
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.film, '.wka/state.json'))).step, 0);
  assert.equal(fs.existsSync(path.join(f.film, '.cache/operation.lock')), false);
});

test('UI drafts and status use same-origin routes and restore across server instances', async t => {
  const f = await fixture(t);
  let r = await f.request('/api/ui'); assert.equal(r.status, 200, '缺少本机草稿读取路由');
  r = await f.request('/api/ui', { key: 'note:test:a:v1', expected: 0, value: { text: '未提交草稿' } });
  assert.equal(r.status, 200); assert.equal((await r.json()).revision, 1);
  assert.equal((await f.request('/api/ui', { key: 'note:test:a:v1', expected: 0, value: null })).status, 400);
  assert.equal((await fetch(f.server.origin + '/api/ui')).status, 403);
  const { startWorkbench } = await import(serverUrl), second = await startWorkbench(f.root); t.after(() => second.close());
  const value = await (await fetch(second.origin + '/api/ui', { headers: { 'Sec-Fetch-Site': 'same-origin', Origin: second.origin } })).json();
  assert.equal(value.entries['note:test:a:v1'].value.text, '未提交草稿');
  const status = await (await f.request('/api/status?film=' + f.id)).json();
  assert.equal(status.busy, false); assert.equal(typeof status.revision, 'string');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.film, '.wka/state.json'))).step, 0);
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
