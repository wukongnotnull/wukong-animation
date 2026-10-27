// 镜号标注：ffmpeg 不带 drawtext（Homebrew 默认构建就不带）时，用 Chromium 把标注文字截成透明 PNG，
// 再由 ffmpeg overlay 叠到接触表和动态分镜上。样子和 drawtext 的标注一致：白字、半透明黑底。
import fs from 'node:fs';
import path from 'node:path';
import { requireDep } from './deps.mjs';
import { ensureDir } from './paths.mjs';

const PAD = 0.3; // 文字四周留白，字号的倍数

/**
 * @param {string[]} texts 每张标注的文字
 * @param {{size?: number, workDir: string}} o size：字号（像素）
 * @returns {Promise<string[]>} 与 texts 一一对应的 PNG 路径
 */
export async function renderLabels(texts, { size = 20, workDir }) {
  const { chromium } = requireDep('playwright');
  const dir = ensureDir(path.join(workDir, 'labels'));
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const pad = Math.round(size * PAD);
    await page.setContent(
      `<html><body style="margin:0;background:transparent"><span id="l" style="display:inline-block;padding:${pad}px ${pad * 1.5}px;` +
        `font:${size}px/1 -apple-system,'PingFang SC','Noto Sans SC',sans-serif;color:#fff;background:rgba(0,0,0,0.5)"></span></body></html>`,
    );
    const el = page.locator('#l');
    const files = [];
    for (const [i, text] of texts.entries()) {
      await page.evaluate((t) => (document.getElementById('l').textContent = t), text);
      const f = path.join(dir, `${String(i + 1).padStart(4, '0')}.png`);
      await el.screenshot({ path: f, omitBackground: true });
      files.push(f);
    }
    return files;
  } finally {
    await browser.close();
  }
}

/** 能用 Chromium 画标注吗（browser 管线依赖装好了）。 */
export function canRenderLabels() {
  try {
    requireDep('playwright');
    return true;
  } catch {
    return false;
  }
}
