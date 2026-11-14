import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { createSession } from '../../plugin/engine/workbench/session.mjs';

const source = fs.readFileSync(new URL('../../plugin/engine/workbench/app.js', import.meta.url), 'utf8');
const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const startup = program.body.findLast(node => node.type === 'ExpressionStatement' && node.expression.callee?.name === 'action').expression.arguments[0];
const films = [{ id: 'first' }, { id: 'target' }];

async function openPage(address, { storage = new Map(), fail = false, readonly = false } = {}) {
  const location = new URL(address), replacements = [], loaded = [];
  const state = { existing: true };
  const context = {
    URL, URLSearchParams, location, localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    ui: { mediaStates: new Map() }, session: null, pollTimer: null, $: () => ({}),
    history: { state, replaceState(nextState, title, url) {
      assert.deepEqual(loaded, ['target']);
      assert.equal(nextState, state);
      replacements.push(url);
      location.href = new URL(url, location).href;
    } },
    api: async route => route === '/api/films' ? { films, workspaceId: 'url-test' } : { entries: {} },
    createSession, updateFilmChoices() {}, applyLayout() {}, connection() {},
    async loadReport() {
      if (fail) throw new Error('report unavailable');
      loaded.push(context.ui.film);
      context.ui.report = { readonly };
      context.rememberPosition();
    },
    scheduleDrafts() {}, poll() {}, setTimeout() { return 1; },
  };
  const sandbox = vm.createContext(context);
  for (const name of ['storeValue', 'rememberPosition']) {
    const node = program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
    vm.runInContext(source.slice(node.start, node.end), sandbox);
  }
  const initialize = vm.runInContext('(' + source.slice(startup.start, startup.end) + ')', sandbox);
  await initialize();
  return { location, replacements, loaded, storage };
}

test('film link opens its target before hiding the parameter and refresh restores that film', async () => {
  const first = await openPage('http://127.0.0.1:63711/?film=target');
  assert.deepEqual(first.loaded, ['target']);
  assert.equal(first.location.href, 'http://127.0.0.1:63711/');
  assert.equal(first.replacements.length, 1);
  const refreshed = await openPage(first.location.href, { storage: first.storage });
  assert.deepEqual(refreshed.loaded, ['target']);
  assert.equal(refreshed.replacements.length, 0);
});

test('hiding film preserves other query parameters and the current path', async () => {
  const page = await openPage('http://127.0.0.1:63711/?film=target&thread=review%20thread&mode=preview');
  assert.equal(page.location.searchParams.has('film'), false);
  assert.equal(page.location.searchParams.get('thread'), 'review thread');
  assert.equal(page.location.searchParams.get('mode'), 'preview');
  assert.equal(page.location.pathname, '/');
});

test('opening without film does not replace history and keeps the default selection', async () => {
  const page = await openPage('http://127.0.0.1:63711/');
  assert.deepEqual(page.loaded, ['first']);
  assert.deepEqual(page.replacements, []);
});

test('readonly film selection also survives hiding the link and refreshing', async () => {
  const first = await openPage('http://127.0.0.1:63711/?film=target', { readonly: true });
  assert.equal(first.location.search, '');
  const refreshed = await openPage(first.location.href, { storage: first.storage, readonly: true });
  assert.deepEqual(refreshed.loaded, ['target']);
});

test('failed report loading keeps the original film link for retry', async () => {
  await assert.rejects(openPage('http://127.0.0.1:63711/?film=target', { fail: true }), /report unavailable/);
});
