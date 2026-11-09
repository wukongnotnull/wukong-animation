import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { startWorkbench } from '../../plugin/engine/cli/workbench-server.mjs';
import { parseArgs } from '../../plugin/engine/core/command-args.mjs';

const cli = fileURLToPath(new URL('../../plugin/engine/bin/wka.mjs', import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-multiple-'));
  const projects = ['甲工程', '乙工程', '未接入工程'].map(name => path.join(root, name));
  const films = projects.map((project, i) => {
    const film = path.join(project, 'films', '同名影片');
    fs.mkdirSync(film, { recursive: true }); initializeProduction(film);
    fs.writeFileSync(path.join(film, 'brief.md'), '# 简报 ' + i);
    return film;
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, projects, films };
}
function request(app, route, body) {
  return fetch(app.origin + route, { method: body ? 'POST' : 'GET', headers: { Origin: app.origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
test('one port serves explicit projects with distinct films and isolated files and feedback', async t => {
  const f = fixture(t), app = await startWorkbench(f.projects[0], { directories: [f.projects[1]] });
  t.after(() => app.close());
  const { films } = await (await request(app, '/api/films')).json();
  assert.equal(films.length, 2);
  assert.equal(new Set(films.map(film => film.id)).size, 2);
  assert.equal(new Set(films.map(film => film.name)).size, 2, '同名影片应可区分');
  const items = [];
  for (const [i, film] of films.entries()) {
    const report = await (await request(app, '/api/report?film=' + film.id)).json();
    const item = report.stages.find(stage => stage.step === 2).items[0]; items.push(item);
    const file = await request(app, `/api/file?film=${film.id}&artifact=${item.id}&version=${item.current.id}`);
    assert.equal(await file.text(), '# 简报 ' + i);
    assert.equal((await request(app, '/api/note', { film: film.id, artifactId: item.id, versionId: item.current.id, text: '意见 ' + i, anchor: { type: 'general' } })).status, 200);
  }
  for (const [i, film] of films.entries()) {
    const pending = await (await request(app, '/api/pending?film=' + film.id)).json();
    assert.deepEqual(pending.notes.map(note => note.text), ['意见 ' + i]);
  }
  assert.equal((await request(app, `/api/file?film=${films[0].id}&artifact=${items[1].id}&version=${items[1].current.id}`)).status, 400);
  assert.equal((await request(app, '/api/report?film=' + encodeURIComponent(f.films[2]))).status, 400);
  assert.equal(fs.existsSync(path.join(f.films[2], '.wka/workbench.json')), false);
});
test('multiple roots deduplicate overlaps and preserve first workspace identities across restart', async t => {
  const f = fixture(t);
  let app = await startWorkbench(f.projects[0]); t.after(() => app.close());
  const before = await (await request(app, '/api/films')).json(), port = Number(new URL(app.origin).port);
  await app.close();
  app = await startWorkbench(f.projects[0], { port, directories: [f.projects[1], f.films[0], f.projects[1]] });
  const listing = await (await request(app, '/api/films')).json();
  assert.equal(listing.films.length, 2);
  assert.equal(listing.workspaceId, before.workspaceId);
  assert.equal(listing.films[0].id, before.films[0].id);
  await app.close();
  app = await startWorkbench(f.projects[0], { port, directories: [f.films[0], f.projects[1]] });
  assert.deepEqual(await (await request(app, '/api/films')).json(), listing);
});
test('invalid additional directories fail before a partial workbench starts', async t => {
  const f = fixture(t);
  for (const directory of [path.join(f.root, 'missing'), path.join(f.films[0], 'brief.md')]) {
    let app; t.after(() => app?.close());
    await assert.rejects(async () => { app = await startWorkbench(f.projects[0], { directories: [directory] }); });
  }
});
test('workbench option values are not mistaken for additional directories', () => {
  const parsed = parseArgs(['workbench', '甲目录', '--port', '63711', '乙目录', '--open']);
  assert.deepEqual(parsed.pos, ['甲目录', '乙目录']);
  const operation = parseArgs(['workbench', '甲目录', '--register', '文件', '--label', '名称', '--depends', '来源', '--step', '3']);
  assert.deepEqual(operation.pos, ['甲目录']);
});
test('CLI starts both directories on one port and refuses multi-film one-shot operations', { timeout: 15000 }, async t => {
  const f = fixture(t);
  const child = spawn(process.execPath, [cli, 'workbench', f.films[0], '--port', '0', f.films[1]], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } });
  const origin = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output); if (match) resolve(match[0]); });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject); child.once('exit', code => reject(new Error('CLI stopped: ' + code + ' ' + output)));
  });
  const listing = await (await request({ origin }, '/api/films')).json();
  assert.deepEqual(listing.films.map(film => film.dir), f.films.slice(0, 2).map(dir => fs.realpathSync(dir)));
  for (const operation of [['--capture'], ['--pending'], ['--register', 'brief.md', '--step', '2'], ['--repair', 'note', '--summary', '说明']]) {
    const result = spawnSync(process.execPath, [cli, 'workbench', ...f.films.slice(0, 2), ...operation], { encoding: 'utf8', timeout: 5000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /只接受一个/);
  }
});
