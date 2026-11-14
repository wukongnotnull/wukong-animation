import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';

const boot = fs.readFileSync(new URL('../../plugin/engine/workbench/theme.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../plugin/engine/workbench/app.js', import.meta.url), 'utf8');
const program = parse(app, { ecmaVersion: 'latest', sourceType: 'module' });
const themeFunctions = program.body.filter(node => node.type === 'FunctionDeclaration' && ['storedTheme', 'applyTheme'].includes(node.id.name)).map(node => app.slice(node.start, node.end)).join('\n');
const key = 'wka-workbench-theme';

function openTheme(stored, { unavailable = false, runBoot = true } = {}) {
  const storage = new Map(stored === null ? [] : [[key, stored]]);
  const buttons = ['light', 'dark'].map(themeChoice => ({
    dataset: { themeChoice },
    setAttribute(name, value) { this[name] = value; },
  }));
  const document = { documentElement: { dataset: {} }, querySelectorAll: () => buttons };
  const localStorage = {
    getItem(name) { if (unavailable) throw new Error('storage unavailable'); return storage.get(name) ?? null; },
    setItem(name, value) { if (unavailable) throw new Error('storage unavailable'); storage.set(name, value); },
  };
  const context = vm.createContext({ document, localStorage });
  if (runBoot) vm.runInContext(boot, context);
  const initial = document.documentElement.dataset.theme;
  vm.runInContext(themeFunctions + '\napplyTheme(storedTheme());', context);
  return { initial, document, buttons, storage, context };
}

for (const stored of [null, '', 'invalid', 'light', 'dark']) {
  test(`theme boot and app use ${stored === 'dark' ? 'dark' : 'light'} for stored preference ${JSON.stringify(stored)}`, () => {
    const page = openTheme(stored);
    const expected = stored === 'dark' ? 'dark' : 'light';
    assert.equal(page.initial, expected);
    assert.equal(page.document.documentElement.dataset.theme, expected);
    assert.equal(page.storage.get(key), expected);
    for (const button of page.buttons) assert.equal(button['aria-pressed'], String(button.dataset.themeChoice === expected));
  });
}

test('unavailable browser storage falls back to light and still allows switching', () => {
  const page = openTheme(null, { unavailable: true });
  assert.equal(page.initial, 'light');
  assert.equal(page.document.documentElement.dataset.theme, 'light');
  vm.runInContext("applyTheme('dark');", page.context);
  assert.equal(page.document.documentElement.dataset.theme, 'dark');
  assert.equal(page.buttons[1]['aria-pressed'], 'true');
});

test('app defaults to light even without the early theme script', () => {
  const page = openTheme(null, { runBoot: false });
  assert.equal(page.document.documentElement.dataset.theme, 'light');
});

test('manual theme choice survives the next page load', () => {
  const page = openTheme(null);
  vm.runInContext("applyTheme('dark');", page.context);
  assert.equal(openTheme(page.storage.get(key)).initial, 'dark');
  vm.runInContext("applyTheme('light');", page.context);
  assert.equal(openTheme(page.storage.get(key)).initial, 'light');
});
