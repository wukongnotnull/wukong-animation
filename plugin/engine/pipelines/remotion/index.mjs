// remotion 管线：生成每镜一个 Composition 的入口 → @remotion/bundler 打包一次 → 逐镜 renderMedia 成无声 H.264 片段。
// 接口（所有管线一致）：check() / renderShots(job, todo, {onDone}) / renderStills(job, points, outDir)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasDep, requireDep, resolveDep } from '../../core/deps.mjs';
import { hasFfmpeg, run } from '../../core/ffmpeg.mjs';
import { ensureDir } from '../../core/paths.mjs';
import { buildEntry, headlessShellFrom, rewriteFontCss, webpackAliases } from './entry.mjs';

const DEPS = ['remotion', '@remotion/bundler', '@remotion/renderer', 'react', 'react-dom'];
/** 必须全片只有一份的包：片目录、风格目录、引擎目录引用的都指向同一处。 */
const SINGLETONS = ['react', 'react-dom', 'remotion'];
const STYLE_ENTRY = /(^|\/)index\.(tsx?|jsx?)$/;

export async function check({ has = hasDep, ffmpeg = hasFfmpeg } = {}) {
  const missing = [...(ffmpeg() ? [] : ['ffmpeg']), ...DEPS.filter((d) => !has(d))];
  return {
    ok: missing.length === 0,
    missing,
    hint: missing.length ? '运行 /wukong-animation:setup（或 node engine/bin/wka.mjs setup）安装依赖。' : '',
  };
}

/** 风格 scripts 里的 index.ts(x)，镜头用 @wka/style 引它；没有就是 null。 */
function styleEntryOf(style) {
  const rel = (style.scripts || []).find((p) => STYLE_ENTRY.test(p));
  return rel ? path.join(style.dir, rel) : null;
}

function browserExecutable(log) {
  let exe = null;
  try {
    exe = headlessShellFrom(requireDep('playwright').chromium.executablePath(), fs);
  } catch {
    /* 没装 playwright：交给 Remotion */
  }
  if (!exe) log('  ! 没找到 playwright 的 chromium headless shell，由 Remotion 自行下载浏览器（约 170 MB）');
  return exe;
}

/** 打包：入口、静态目录（风格 assets/ 与字体）、别名。一次任务只做一次。 */
async function prepare(job) {
  const dir = ensureDir(path.join(job.workDir, `remotion-${job.proxy ? 'proxy' : 'full'}`));
  const publicDir = path.join(dir, 'public');
  fs.rmSync(publicDir, { recursive: true, force: true });
  ensureDir(publicDir);
  const assets = path.join(job.style.dir, 'assets');
  if (fs.existsSync(assets)) fs.cpSync(assets, path.join(publicDir, 'assets'), { recursive: true });
  const fonts = rewriteFontCss(job.fonts.css);
  for (const f of fonts.files) {
    ensureDir(path.dirname(path.join(publicDir, f.to)));
    fs.copyFileSync(f.from, path.join(publicDir, f.to));
  }
  const entryJob = { ...job, styleEntry: styleEntryOf(job.style) };
  const entryPoint = path.join(dir, 'index.jsx');
  fs.writeFileSync(entryPoint, buildEntry(entryJob, fonts.css));

  const alias = { ...webpackAliases(entryJob), ...Object.fromEntries(SINGLETONS.map((n) => [n, resolveDep(n)])) };
  // 片目录和风格目录下没有 node_modules：让 webpack 也到依赖所在的 node_modules 里找
  const modules = [path.dirname(resolveDep('react'))];
  const { bundle } = requireDep('@remotion/bundler');
  let serveUrl;
  try {
    serveUrl = await bundle({
      entryPoint,
      publicDir,
      outDir: path.join(dir, 'bundle'),
      // webpack 缓存放进工作目录，不往用户主目录写
      rootDir: dir,
      webpackOverride: (c) => ({
        ...c,
        resolve: {
          ...c.resolve,
          alias: { ...(c.resolve?.alias || {}), ...alias },
          modules: [...(c.resolve?.modules || ['node_modules']), ...modules],
        },
      }),
    });
  } catch (e) {
    throw new Error(`《${job.film.title}》打包失败：${e.message}`);
  }
  return { serveUrl, browserExecutable: browserExecutable(job.log) };
}

async function withBrowser(job, fn) {
  const r = requireDep('@remotion/renderer');
  const { serveUrl, browserExecutable: exe } = await prepare(job);
  const browser = await r.openBrowser('chrome', { browserExecutable: exe, logLevel: 'error' });
  try {
    return await fn({ r, serveUrl, puppeteerInstance: browser, browserExecutable: exe });
  } finally {
    await browser.close({ silent: true }).catch(() => {});
  }
}

const shotLabel = (shot) => `镜头 ${shot.id} (${shot.file})`;

export async function renderShots(job, todo, { onDone } = {}) {
  const concurrency = Number(process.env.WKA_WORKERS) || Math.min(2, os.cpus().length);
  await withBrowser(job, async (env) => {
    for (const item of todo) {
      await renderShot(job, item, env, concurrency);
      onDone?.(item);
    }
  });
}

/** 渲染一个镜头到 out。先写 .part.mp4，成功才改名；小样再用 ffmpeg 降到 job.fps。失败删半成品。 */
async function renderShot(job, { shot, out }, { r, serveUrl, puppeteerInstance, browserExecutable: exe }, concurrency) {
  const part = out.replace(/\.mp4$/, '') + '.part.mp4';
  const raw = job.fps === job.film.fps ? part : part.replace(/\.part\.mp4$/, '.raw.part.mp4');
  try {
    const composition = await r.selectComposition({ serveUrl, id: shot.id, puppeteerInstance, browserExecutable: exe, logLevel: 'error' });
    const t0 = Date.now();
    let nextLog = 0.25;
    await r.renderMedia({
      composition, serveUrl, puppeteerInstance, browserExecutable: exe, concurrency, logLevel: 'error',
      codec: 'h264', muted: true, crf: job.proxy ? 23 : 16, pixelFormat: 'yuv420p',
      scale: job.W / job.designW, outputLocation: raw, overwrite: true,
      onProgress: ({ progress, renderedFrames }) => {
        if (progress < nextLog) return;
        job.log(`  ${shot.id} ${Math.round(progress * 100)}%  (${renderedFrames}/${composition.durationInFrames} 帧, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        while (nextLog <= progress) nextLog += 0.25;
      },
    });
    if (raw !== part) {
      await run(['-i', raw, '-vf', `fps=${job.fps}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', part]);
      fs.rmSync(raw, { force: true });
    }
    fs.renameSync(part, out);
  } catch (e) {
    fs.rmSync(part, { force: true });
    fs.rmSync(raw, { force: true });
    throw new Error(`${shotLabel(shot)} 渲染失败：${e.message}`);
  }
}

export async function renderStills(job, points, outDir) {
  return withBrowser(job, async ({ r, serveUrl, puppeteerInstance, browserExecutable: exe }) => {
    const files = [];
    for (const p of points) {
      const shot = job.shots.find((s) => s.id === p.shot);
      if (!shot) throw new Error(`没有镜头 ${p.shot}`);
      const t = Math.min(p.t, shot.duration - 1e-3);
      const file = path.join(outDir, `${shot.id}-${t.toFixed(2)}s.png`);
      try {
        const composition = await r.selectComposition({ serveUrl, id: shot.id, puppeteerInstance, browserExecutable: exe, logLevel: 'error' });
        const frame = Math.min(composition.durationInFrames - 1, Math.round(t * job.film.fps));
        await r.renderStill({ composition, serveUrl, puppeteerInstance, browserExecutable: exe, logLevel: 'error', frame, output: file, imageFormat: 'png', scale: job.W / job.designW, overwrite: true });
      } catch (e) {
        throw new Error(`${shotLabel(shot)} @${t}s 出错：${e.message}`);
      }
      files.push(file);
    }
    return files;
  });
}
