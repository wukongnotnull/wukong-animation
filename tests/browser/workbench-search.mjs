// Run against an isolated workbench containing story.md with the search fixture.
// node tests/browser/workbench-search.mjs http://127.0.0.1:63917 outputs/workbench-search
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../plugin/engine/package.json', import.meta.url));
const { chromium } = require('playwright');
const origin = process.argv[2];
assert.ok(origin, '需要隔离工作台 URL');
const output = path.resolve(process.argv[3] || 'outputs/workbench-search');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.coverage.startJSCoverage();
  await page.goto(origin);
  await page.locator('.workspace:not([hidden])').waitFor();
  for (const label of ['展开文件栏', '展开审阅栏']) {
    const toggle = page.getByRole('button', { name: label, exact: true });
    if (await toggle.count()) await toggle.click();
  }
  await page.getByRole('button', { name: /编写剧本/ }).click();
  await page.locator('#files .file').filter({ hasText: '剧本' }).click();
  await page.locator('#file-name').filter({ hasText: '剧本' }).waitFor();
  const input = page.getByRole('searchbox', { name: '搜索文件内容', exact: true });
  const status = page.locator('#document-search-status');
  const textIs = async text => {
    await page.waitForFunction(expected => document.getElementById('document-search-status').textContent === expected, text);
  };
  await input.fill('内容'); await textIs('1 / 1');
  await page.setViewportSize({ width: 375, height: 1000 }); await textIs('无匹配');
  await page.setViewportSize({ width: 1440, height: 1000 }); await textIs('1 / 1');
  await input.fill('悟空'); await textIs('1 / 4');
  assert.equal(await page.evaluate(() => CSS.highlights.get('document-search-results').size), 4);
  await input.press('Enter'); await textIs('2 / 4');
  await input.press('Shift+Enter'); await textIs('1 / 4');
  await page.getByRole('button', { name: '上一个匹配', exact: true }).click(); await textIs('4 / 4');
  assert.ok(await page.locator('#document').evaluate(node => node.scrollTop) > 500);
  await page.getByRole('button', { name: '下一个匹配', exact: true }).click(); await textIs('1 / 4');
  await input.fill('.*[x]'); await textIs('1 / 1');
  await input.fill('ABC'); await textIs('1 / 2');
  await input.fill('不存在'); await textIs('无匹配');
  assert.equal(await page.getByRole('button', { name: '下一个匹配', exact: true }).isDisabled(), true);
  await input.press('Escape'); await textIs('');
  assert.equal(await input.inputValue(), '');
  await input.fill('悟空');
  await page.getByRole('button', { name: '查看原文', exact: true }).click(); await textIs('1 / 3');
  assert.equal(await input.inputValue(), '悟空');
  await page.getByRole('button', { name: '排版阅读', exact: true }).click(); await textIs('1 / 4');
  const versions = await page.locator('#versions option').evaluateAll(nodes => nodes.map(node => node.value));
  assert.ok(versions.length >= 2);
  await page.locator('#versions').selectOption(versions.at(-1)); await textIs('1 / 4');
  assert.equal(await input.inputValue(), '悟空');
  await page.locator('#versions').selectOption(versions[0]); await textIs('1 / 4');

  // A search never wraps text, changes source offsets, or owns Selection.
  const anchors = await page.evaluate(async () => {
    const { documentAnchor } = await import('/document.mjs');
    const { createDocumentSearch } = await import('/search.mjs');
    const root = document.getElementById('document');
    const range = CSS.highlights.get('document-search-results').values().next().value;
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const listing = await (await fetch('/api/films')).json();
    const report = await (await fetch('/api/report?film=' + listing.films[0].id)).json();
    const file = report.stages.find(stage => stage.step === 3).items.find(file => file.path.endsWith('story.md'));
    const raw = await (await fetch('/api/file?' + new URLSearchParams({ film: listing.films[0].id, artifact: file.id, version: file.current.id }))).text();
    const before = documentAnchor(root, selection, raw), html = root.innerHTML;
    document.querySelector('[data-search=next]').click();
    const during = documentAnchor(root, selection, raw);
    document.querySelector('[data-search=clear]').click();
    // Focusing the search input may collapse Selection; selecting the same range still maps identically.
    selection.removeAllRanges(); selection.addRange(range);
    const after = documentAnchor(root, selection, raw);
    // Test cross-inline matches, block boundaries, and graceful fallback separately.
    const fixture = document.createElement('article'); fixture.style.cssText = 'position:fixed;top:0;left:0';
    const { renderDocument } = await import('/document.mjs');
    fixture.append(renderDocument('前**后**\n\n跨\n段\n\n| A | B |\n|---|---|\n| 左 | 右 |', true));
    document.body.append(fixture);
    const { documentSearchRanges } = await import('/search.mjs');
    const counts = ['前后', '跨段', '左右'].map(query => documentSearchRanges(fixture, query).length);
    const controls = document.getElementById('document-search').cloneNode(true);
    document.body.append(controls);
    const original = globalThis.Highlight; globalThis.Highlight = undefined;
    // This temporary controller must not leave a resize listener competing with the real app.
    const originalMatchMedia = globalThis.matchMedia;
    globalThis.matchMedia = () => ({ addEventListener() {} });
    const fallback = createDocumentSearch(controls);
    globalThis.matchMedia = originalMatchMedia;
    fallback.bind(fixture, 'fallback');
    controls.querySelector('input').value = '前后'; controls.querySelector('input').dispatchEvent(new Event('input'));
    const fallbackWorks = !!fixture.querySelector('.search-current-fallback');
    controls.querySelector('input').focus();
    fallback.bind(null, 'fallback');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    fallback.bind(fixture, 'fallback');
    const restoredFocus = document.activeElement === controls.querySelector('input');
    fallback.bind(null, 'empty'); globalThis.Highlight = original;
    controls.remove(); fixture.remove();
    const large = renderDocument('```\n' + '悟空\n'.repeat(20000) + '```', true);
    document.body.append(large); large.getBoundingClientRect();
    const started = performance.now(), largeCount = documentSearchRanges(large, '悟空').length;
    const largeSearchMs = performance.now() - started;
    large.remove();
    return { before, during, after, unchanged: html === root.innerHTML, counts, fallbackWorks, restoredFocus, largeCount, largeSearchMs };
  });
  assert.deepEqual(anchors.before, anchors.during);
  assert.deepEqual(anchors.before, anchors.after);
  assert.equal(anchors.before.quote, '悟空');
  assert.equal(anchors.unchanged, true);
  assert.deepEqual(anchors.counts, [1, 0, 0]);
  assert.equal(anchors.fallbackWorks, true);
  assert.equal(anchors.restoredFocus, true);
  assert.equal(anchors.largeCount, 20000);
  await page.getByRole('button', { name: /画面示例/ }).click();
  assert.equal(await page.locator('#document-search').isHidden(), true);
  assert.equal(await page.evaluate(() => CSS.highlights.has('document-search-results')), false);
  await page.locator('#files .file').filter({ hasText: '剧本' }).click();
  await input.waitFor(); assert.equal(await input.inputValue(), '');
  await input.fill('悟空'); await textIs('1 / 4');
  await page.getByRole('button', { name: '收起文件栏', exact: true }).click();
  await page.getByRole('button', { name: '收起审阅栏', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.locator(`[data-theme-choice=${theme}]`).click();
    for (const width of [320, 375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.locator('#document-search').evaluate(node => {
        const rect = node.getBoundingClientRect(), parent = node.closest('.viewer-toolbar').getBoundingClientRect();
        return { inside: rect.left >= parent.left && rect.right <= parent.right, overflow: node.scrollWidth > node.clientWidth };
      });
      assert.equal(await page.evaluate(() => CSS.highlights.get('document-search-results')?.size), 4);
      assert.equal(layout.inside, true, `${theme} ${width}: 搜索框不得溢出工具栏`);
      assert.equal(layout.overflow, false, `${theme} ${width}: 搜索控件不得互相挤出`);
      if ([320, 768, 1024, 1440].includes(width)) await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), animations: 'disabled' });
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await input.focus(); await input.press('Enter'); await textIs('2 / 4');
  await input.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '上一个匹配');
  assert.equal(await page.locator('search[aria-label="搜索当前文档"]').count(), 1);
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  assert.deepEqual(errors, []);
  const coverage = await page.coverage.stopJSCoverage();
  const entry = coverage.find(entry => entry.url.endsWith('/search.mjs'));
  const used = new Uint8Array(entry.source.length);
  const ranges = entry.functions.flatMap(fn => fn.ranges).sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
  for (const range of ranges) used.fill(range.count > 0 ? 1 : 0, range.startOffset, range.endOffset);
  const coveragePercent = Math.round(used.reduce((sum, byte) => sum + byte, 0) / used.length * 100);
  assert.ok(coveragePercent >= 80, `搜索模块浏览器覆盖率 ${coveragePercent}%`);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ok: true, coveragePercent, errors, anchors, breakpoints: [320, 375, 768, 1024, 1440, 1920] }, null, 2));
  console.log(`搜索浏览器验证通过；模块字节覆盖率 ${coveragePercent}%；截图：${output}`);
} finally {
  await browser.close();
}
