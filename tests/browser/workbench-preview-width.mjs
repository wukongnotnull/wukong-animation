// node tests/browser/workbench-preview-width.mjs [screenshot.png]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { startWorkbench } from '../../plugin/engine/cli/workbench-server.mjs';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { registerWorkbenchArtifact } from '../../plugin/engine/core/workbench.mjs';

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
  for (const [file, label, width, height] of [['wide.svg', '横图', 400, 100], ['tall.svg', '竖图', 100, 400]]) {
    fs.writeFileSync(path.join(directory, file), `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#2d6a32"/></svg>`);
    registerWorkbenchArtifact(directory, { file, step: 3, label });
  }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', path.join(directory, 'sample.wav')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=320x180:d=1', '-c:v', 'libx264', path.join(directory, 'sample.mp4')]);
  registerWorkbenchArtifact(directory, { file: 'sample.wav', step: 3, label: '音频样本' });
  registerWorkbenchArtifact(directory, { file: 'sample.mp4', step: 3, label: '视频样本' });
  fs.mkdirSync(path.join(directory, 'draft'));
  fs.writeFileSync(path.join(directory, 'draft', 'project.json'), '{}');
  registerWorkbenchArtifact(directory, { file: 'draft', step: 3, label: '工程样本' });
  app = await startWorkbench(directory);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1414, height: 1000 } });
  await page.goto(app.url);
  await page.locator('#toggle-inspector').click();
  await page.getByRole('button', { name: /规划镜头/ }).click();
  const document = page.locator('#document');
  const table = document.locator('.table-wrap');
  await table.waitFor();

  const layout = (content = document) => content.evaluate(node => {
    const viewer = node.closest('#viewer');
    const style = getComputedStyle(viewer);
    const availableWidth = viewer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const availableHeight = viewer.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const { width, height } = node.getBoundingClientRect();
    return { availableWidth, availableHeight, width, height, fit: getComputedStyle(node).objectFit };
  });
  const assertFullWidth = async (content = document) => {
    const { width, availableWidth } = await layout(content);
    assert.ok(Math.abs(availableWidth - width) <= 1, `内容宽 ${width}px，预览可用宽度 ${availableWidth}px`);
  };
  const assertTableFits = async () => {
    await assertFullWidth();
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
  await assertFullWidth();
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
  const openFile = async (label, selector) => {
    await page.locator('#files .file').filter({ hasText: label }).click();
    const content = page.locator(selector);
    await content.waitFor();
    return content;
  };
  await assertFullWidth(await openFile('剧本', '#document.formatted'));
  await assertFullWidth(await openFile('音频样本', '#viewer audio'));
  const video = await openFile('视频样本', '#viewer video');
  await page.waitForFunction(() => document.querySelector('#viewer video').videoWidth > 0);
  await assertFullWidth(video);
  const videoLayout = await layout(video);
  assert.ok(Math.abs(videoLayout.height - videoLayout.availableHeight) <= 1);
  assert.equal(videoLayout.fit, 'contain');
  await assertFullWidth(await openFile('工程样本', '#viewer .directory'));

  for (const [label, aspect] of [['横图', 4], ['竖图', 1 / 4]]) {
    const image = await openFile(label, '#viewer img');
    await page.waitForFunction(() => document.querySelector('#viewer img').naturalWidth > 0);
    const { width, height, availableWidth, availableHeight } = await layout(image);
    assert.ok(Math.abs(width - Math.min(availableWidth, availableHeight * aspect)) <= 1, label);
    assert.ok(Math.abs(height - width / aspect) <= 1, label);
    await image.click({ position: { x: width / 4, y: height * 3 / 4 } });
    const pin = await page.locator('#viewer .pin').boundingBox();
    const bounds = await image.boundingBox();
    assert.ok(Math.abs(pin.x + pin.width / 2 - (bounds.x + width / 4)) <= 1);
    assert.ok(Math.abs(pin.y + pin.height / 2 - (bounds.y + height * 3 / 4)) <= 1);
  }
  console.log('全宽预览验证通过（分镜、原文、普通文档、音视频、工程列表及图片批注）');
} finally {
  await browser?.close();
  await app?.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
