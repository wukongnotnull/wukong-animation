// Run against tests/browser/workbench-search-server.mjs.
// node tests/browser/workbench-fullscreen.mjs http://127.0.0.1:63917 outputs/workbench-fullscreen
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../plugin/engine/package.json', import.meta.url));
const { chromium } = require('playwright');
const origin = process.argv[2];
assert.ok(origin, '需要隔离工作台 URL');
const output = path.resolve(process.argv[3] || 'outputs/workbench-fullscreen');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.locator('.workspace:not([hidden])').waitFor();
  const enter = page.getByRole('button', { name: '全屏预览', exact: true });
  const exit = page.getByRole('button', { name: '退出全屏', exact: true });
  for (const theme of ['浅色', '深色']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    assert.equal(await exit.isVisible(), false);
    await enter.click();
    await page.waitForFunction(() => document.fullscreenElement?.id === 'viewer');
    await exit.waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(output, `${theme}-fullscreen.png`) });
    await exit.click();
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await exit.isVisible(), false);
    assert.equal(await enter.evaluate(node => document.activeElement === node), true);
  }
  // Re-render the viewer with a different media type, then exit using the keyboard.
  await page.getByRole('button', { name: /编写剧本/ }).click();
  await page.locator('#files .file').filter({ hasText: '画面示例' }).click();
  await page.locator('#viewer img').waitFor();
  await enter.click();
  await page.waitForFunction(() => document.fullscreenElement?.id === 'viewer');
  await exit.focus();
  const exitNode = await exit.elementHandle();
  await page.locator('#versions').evaluate(node => node.dispatchEvent(new Event('change')));
  await page.locator('#viewer img').waitFor();
  assert.equal(await exitNode.evaluate(node => node.isConnected && document.activeElement === node), true, '重绘后保留退出按钮及键盘焦点');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.fullscreenElement);
  assert.equal(await exit.isVisible(), false);
  assert.equal(await enter.evaluate(node => document.activeElement === node), true);
  assert.deepEqual(errors, []);
  console.log('通过：浅色/深色全屏退出、普通预览隐藏、重绘后可用、键盘 Enter 退出、焦点恢复，无运行时错误。');
} finally {
  await browser.close();
}
