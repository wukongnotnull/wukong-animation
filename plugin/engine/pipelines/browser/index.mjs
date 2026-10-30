// browser 管线：Chromium 逐帧 seek → JPEG → ffmpeg(libx264)。
// 接口（所有管线一致）：check() / renderShots(job, todo, {onDone}) / renderStills(job, points, outDir)
import fs from 'node:fs';
import { renderWorkers } from '../../core/render-profile.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireDep } from '../../core/deps.mjs';
import { hasFfmpeg, openImagePipe } from '../../core/ffmpeg.mjs';
import { ENGINE_VERSION } from '../../core/paths.mjs';
import { aspectOf, orientationOf } from '../../core/variants.mjs';

const RUNTIME_ORDER = ['wk.js', 'rng.js', 'easing.js', 'noise.js', 'timeline.js'];

const LAUNCH_ARGS = [
  '--allow-file-access-from-files',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  // 2D 画布走 CPU 光栅：在无 GPU 的机器上比 SwiftShader 模拟快 5–10 倍（WebGL 仍走 SwiftShader）
  '--disable-accelerated-2d-canvas',
  '--disable-background-timer-throttling',
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
];

export async function check() {
  const missing = [];
  if (!hasFfmpeg()) missing.push('ffmpeg');
  let pw = null;
  try {
    pw = requireDep('playwright');
  } catch {
    missing.push('playwright');
  }
  if (pw) {
    try {
      const exe = pw.chromium.executablePath();
      if (!exe || !fs.existsSync(exe)) missing.push('chromium');
    } catch {
      missing.push('chromium');
    }
  }
  return {
    ok: missing.length === 0,
    missing,
    hint: missing.length ? '运行 /wukong-animation:setup（或 node engine/bin/wka.mjs setup）安装依赖。' : '',
  };
}

function buildHost(job) {
  const scripts = [
    ...RUNTIME_ORDER.map((f) => path.join(job.runtimeDir, f)),
    ...job.kits.map((k) => k.entryPath),
    ...job.styleScripts,
    ...job.filmScripts,
  ];
  for (const s of scripts) if (!fs.existsSync(s)) throw new Error(`脚本不存在: ${s}`);
  const config = {
    engineVersion: ENGINE_VERSION,
    W: job.W,
    H: job.H,
    designW: job.designW,
    designH: job.designH,
    aspect: aspectOf([job.designW, job.designH]),
    orientation: orientationOf([job.designW, job.designH]),
    fps: job.fps,
    seed: job.seed,
    fonts: job.fonts.stacks,
    proxy: job.proxy,
    style: job.style.id,
    cues: job.film.cues || {},
  };
  const tpl = fs.readFileSync(path.join(job.runtimeDir, 'host.html'), 'utf8');
  const html = tpl
    .replace('{{FONT_CSS}}', job.fonts.css)
    .replace('{{CONFIG}}', JSON.stringify(config))
    .replace('{{W}}', job.W)
    .replace('{{H}}', job.H)
    .replace('{{SCRIPTS}}', scripts.map((s) => `<script src="${pathToFileURL(s).href.replace(/"/g,'%22')}"></script>`).join('\n'));
  const file = path.join(job.workDir, `host-${job.proxy ? 'proxy' : 'full'}.html`);
  fs.writeFileSync(file, html);
  return file;
}

async function openShotPage(browser, job, hostFile, shot) {
  const page = await browser.newPage({ viewport: { width: job.W, height: job.H }, deviceScaleFactor: 1 });
  const errors = [];
  const warned = new Set();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.type() === 'warning' && !warned.has(m.text())) {
      warned.add(m.text());
      job.log(`  [${shot.id}] ${m.text()}`);
    }
  });
  try {
    await loadShot(page, job, hostFile, shot, errors);
  } catch (e) {
    await page.close().catch(() => {});
    throw e;
  }
  return { page, errors };
}

async function loadShot(page, job, hostFile, shot, errors) {
  await page.goto(pathToFileURL(hostFile).href);
  if (errors.length) throw new Error(`宿主页加载出错：${errors.join(' | ')}`);
  // 等字体就绪，避免前几帧用了 fallback 字体
  await page.evaluate(async (families) => {
    await Promise.all(families.map((f) => document.fonts.load(`48px '${f}'`, '永字八法').catch(() => {})));
    await document.fonts.ready;
  }, Object.keys(job.fonts.stacks));
  await page.evaluate((id) => wk._beginShot(id), shot.id);
  await page.addScriptTag({ path: shot.path });
  await page.evaluate(() => wk._endShot());
  const ok = await page.evaluate((id) => wk._hasShot(id), shot.id);
  if (errors.length || !ok) {
    throw new Error(`镜头 ${shot.id} (${shot.file}) 加载失败：${errors.join(' | ') || '文件里没有调用 wk.shot()'}`);
  }
}

async function renderFrame(page, shot, t, frame, type, quality) {
  const b64 = await page.evaluate(
    ([id, meta, t, frame, type, quality]) => {
      wk._renderAt(id, meta, t, frame);
      return wk._grab(type, quality);
    },
    [shot.id, { duration: shot.duration, start: shot.start, renderStart: shot.renderStart, wordFrames: shot.wordFrames }, t, frame, type, quality]
  );
  return Buffer.from(b64, 'base64');
}

export async function renderShots(job, todo, { onDone } = {}) {
  const { chromium } = requireDep('playwright');
  const hostFile = buildHost(job);
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const workers = Math.min(todo.length, renderWorkers(job));
  const queue = [...todo];
  // 任何一个镜头失败，其余 worker 在下一帧停下；等所有 worker 都收拾干净再关浏览器
  const abort = { error: null };
  try {
    const worker = async () => {
      while (queue.length && !abort.error) {
        const item = queue.shift();
        try {
          await renderShot(browser, job, hostFile, item, abort);
          onDone?.(item);
        } catch (e) {
          abort.error ??= e;
        }
      }
    };
    await Promise.all(Array.from({ length: workers }, worker));
    if (abort.error) throw abort.error;
  } finally {
    await browser.close();
  }
}

/** 渲染一个镜头到 out。先写 .part，成功才改名；失败时杀掉编码器、关页面、删半成品。 */
async function renderShot(browser, job, hostFile, { shot, out }, abort) {
  const part = out + '.part';
  let page = null;
  let enc = null;
  try {
    let errors;
    ({ page, errors } = await openShotPage(browser, job, hostFile, shot));
    const n = shot.frames;
    enc = openImagePipe([
      '-f', 'image2pipe', '-framerate', String(job.fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', job.proxy ? 'veryfast' : 'fast',
      '-crf', job.proxy ? '23' : '16', '-pix_fmt', 'yuv420p',
      ...(job.proxy || job.daily ? ['-threads', '2'] : []),
      '-r', String(job.fps), '-movflags', '+faststart', '-f', 'mp4', part,
    ]);
    const t0 = Date.now();
    let nextLog = 0.25;
    for (let i = 0; i < n; i++) {
      if (abort.error) throw new Error(`镜头 ${shot.id} 已中止（另一个镜头失败）`);
      const buf = await renderFrame(page, shot, i / job.fps, i, 'image/jpeg', job.proxy ? 0.85 : 0.95);
      if (errors.length) throw new Error(`镜头 ${shot.id} 第 ${i} 帧出错：${errors.join(' | ')}`);
      await enc.write(buf);
      if ((i + 1) / n >= nextLog) {
        job.log(`  ${shot.id} ${Math.round(((i + 1) / n) * 100)}%  (${i + 1}/${n} 帧, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        nextLog += 0.25;
      }
    }
    await enc.end();
    enc = null;
    fs.renameSync(part, out);
  } catch (e) {
    await enc?.abort();
    fs.rmSync(part, { force: true });
    throw e;
  } finally {
    await page?.close().catch(() => {});
  }
}

export async function renderStills(job, points, outDir) {
  const { chromium } = requireDep('playwright');
  const hostFile = buildHost(job);
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const files = [];
  try {
    const byShot = new Map();
    for (const p of points) {
      if (!byShot.has(p.shot)) byShot.set(p.shot, []);
      byShot.get(p.shot).push(p);
    }
    for (const [id, pts] of byShot) {
      const shot = job.shots.find((s) => s.id === id);
      if (!shot) throw new Error(`没有镜头 ${id}`);
      const { page, errors } = await openShotPage(browser, job, hostFile, shot);
      try {
        for (const p of pts) {
          const t = Math.min(p.t, (shot.frames - 1) / job.fps);
          const buf = await renderFrame(page, shot, t, Math.round(t * job.fps), 'image/png');
          if (errors.length) throw new Error(`镜头 ${id} @${t}s 出错：${errors.join(' | ')}`);
          const f = path.join(outDir, `${id}-${t.toFixed(2)}s.png`);
          fs.writeFileSync(f, buf);
          files.push(f);
        }
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }
  return files;
}
