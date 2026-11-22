// node tests/browser/workbench-wide-tables.mjs [screenshot.png]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startWorkbench } from '../../plugin/engine/cli/workbench-server.mjs';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';

const require = createRequire(new URL('../../plugin/engine/package.json', import.meta.url));
const { chromium } = require('playwright');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-wide-tables-'));
let app, browser;
try {
  initializeProduction(directory);
  fs.writeFileSync(path.join(directory, 'story.md'), '# 剧本\n\n旁白正文。\n');
  fs.writeFileSync(path.join(directory, 'storyboard.md'), [
    '# 分镜稿', '',
    '| 镜 | 段落 | 时长 · 全片位置 | 转场 | 景别 | 画面 | 运镜 / 动效 | 屏幕文字 | 人声 | 音效 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| s01 | P01 | 3.2 秒 0:00.0–0:03.2 | — | 远景 | 片名稳在左上，八张卡片各有图标、名称和用途。参考：[构图](./media/' + 'reference-image-'.repeat(20) + '.png) | 八卡沿弧线轮播，再依次展开为两行四列。 | 片名与八个名称 | 开头介绍内容与用途。 | 卡片掠过音 |',
    '| s02 | P02 | 5 秒 0:03.2–0:08.2 | hold | 中景 | 卡片移到左栏，右侧展示笔记。 | 两张笔记先后落下，保留尚未填上出处的位置。 | 笔记与出处 | 选题时会收集许多资料。 | 纸张落下音 |',
  ].join('\n'));
  app = await startWorkbench(directory);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1414, height: 1000 } });
  await page.goto(app.url);
  await page.locator('#toggle-inspector').click();
  await page.getByRole('button', { name: /规划镜头/ }).click();
  const document = page.locator('#document');
  const table = document.locator('.table-wrap');
  await table.waitFor();

  const layout = () => document.evaluate(doc => {
    const viewer = doc.parentElement;
    const style = getComputedStyle(viewer);
    const available = viewer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return { available, width: doc.getBoundingClientRect().width };
  });
  const assertTableFits = async () => {
    const { width, available } = await layout();
    assert.ok(Math.abs(available - width) <= 1, `文档宽 ${width}px，预览可用宽度 ${available}px`);
    const fit = await table.evaluate(wrap => {
      const headers = [...wrap.querySelectorAll('th')];
      const right = wrap.getBoundingClientRect().right;
      return {
        headers: headers.length, visible: headers.every(header => header.getBoundingClientRect().right <= right + 1),
        overflow: wrap.scrollWidth - wrap.clientWidth,
        columnWidths: headers.map(header => header.getBoundingClientRect().width),
        shotLines: wrap.querySelector('tbody td span').getClientRects().length,
      };
    });
    assert.equal(fit.headers, 10);
    assert.ok(fit.visible && fit.overflow <= 1, JSON.stringify(fit));
    assert.equal(fit.shotLines, 1, '正常桌面宽度下镜号应占一行');
    assert.ok(fit.columnWidths[5] <= fit.columnWidths[6] * 1.1, '画面里的长路径不应挤窄运镜列');
  };
  await assertTableFits();
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
  await page.locator('#toggle-inspector').click();
  await assertTableFits();
  await page.getByRole('button', { name: '查看原文' }).click();
  await page.locator('#document.raw').waitFor();
  await page.locator('#toggle-inspector').click();
  assert.equal((await layout()).width, 1100);
  await page.getByRole('button', { name: '排版阅读' }).click();
  await table.waitFor();
  await page.locator('#toggle-library').click();
  await page.setViewportSize({ width: 390, height: 900 });
  const cells = table.locator('tbody tr').first().locator('td');
  assert.equal(await cells.count(), 10);
  assert.equal(await cells.last().getAttribute('data-label'), '音效');
  assert.equal(await cells.last().evaluate(cell => getComputedStyle(cell).display), 'block');
  assert.equal(await table.evaluate(wrap => wrap.scrollWidth - wrap.clientWidth), 0);

  await page.setViewportSize({ width: 1414, height: 1000 });
  await page.locator('#toggle-library').click();
  await page.getByRole('button', { name: /编写剧本/ }).click();
  await document.getByRole('heading', { name: '剧本' }).waitFor();
  assert.equal((await layout()).width, 1100);
  console.log('分镜表验证通过（桌面双侧栏状态、原文、手机和普通剧本）');
} finally {
  await browser?.close();
  await app?.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
