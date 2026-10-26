// 一次渲染任务：读 film.json → 解析风格 → 按镜头调度渲染（带缓存）→ 拼接 → 混音 → 导出。
import fs from 'node:fs';
import path from 'node:path';
import { getRegistry, getStyles, loadModule } from './registry.mjs';
import { resolveStyle } from './resolver.mjs';
import { validate } from './validate.mjs';
import { ShotCache, hashParts } from './cache.mjs';
import { prepareFonts, collectText } from './fonts.mjs';
import { ENGINE_VERSION, ENGINE_ROOT, ensureDir } from './paths.mjs';
import { run, hasDrawtext, drawLabel } from './ffmpeg.mjs';
import { pickCues } from './cues.mjs';
import { migrateFilm } from './compat.mjs';

const PROXY_SPEC = { scale: 0.5, fpsDiv: 2 };

export function loadFilm(filmDir) {
  filmDir = path.resolve(filmDir);
  const file = path.join(filmDir, 'film.json');
  if (!fs.existsSync(file)) throw new Error(`找不到 ${file}`);
  const { film, renamed: legacyFields } = migrateFilm(JSON.parse(fs.readFileSync(file, 'utf8')));
  const errs = validate('film', film, 'film.json');
  if (errs.length) throw new Error('film.json 校验失败:\n  ' + errs.join('\n  '));

  const registry = getRegistry();
  const { styles } = getStyles();
  const style = styles.get(film.style);
  if (!style) throw new Error(`film.json 使用的风格 "${film.style}" 不存在。可用: ${[...styles.keys()].join(', ')}`);
  const resolved = resolveStyle(style, registry);
  if (resolved.errors.length) throw new Error('风格解析失败:\n  ' + resolved.errors.join('\n  '));

  let t = 0;
  const shots = film.shots.map((s) => {
    const shot = { ...s, start: t, path: path.join(filmDir, s.file) };
    if (!fs.existsSync(shot.path)) throw new Error(`镜头 ${s.id} 的文件不存在: ${s.file}`);
    t += s.duration;
    return shot;
  });

  const styleScripts = (style.scripts || []).map((p) => path.join(style.dir, p));
  const filmScripts = (film.scripts || []).map((p) => path.join(filmDir, p));
  return { film, filmDir, legacyFields, style, registry, ...resolved, shots, totalDuration: t, styleScripts, filmScripts };
}

/** 构建传给管线的任务描述。 */
function createRenderJob(ctx, { proxy = false, log }) {
  const [W0, H0] = ctx.film.size;
  const scale = proxy ? PROXY_SPEC.scale : 1;
  const W = Math.round((W0 * scale) / 2) * 2;
  const H = Math.round((H0 * scale) / 2) * 2;
  const fps = proxy ? Math.max(1, Math.round(ctx.film.fps / PROXY_SPEC.fpsDiv)) : ctx.film.fps;
  const workDir = ensureDir(path.join(ctx.filmDir, '.cache', 'work'));
  const text = collectText([...ctx.shots.map((s) => s.path), ...ctx.filmScripts]);
  const fonts = prepareFonts(ctx.style.fonts || [], { text, workDir, log });
  return {
    ...ctx,
    W,
    H,
    designW: W0,
    designH: H0,
    fps,
    proxy,
    seed: ctx.film.seed,
    fonts,
    workDir,
    runtimeDir: path.join(ENGINE_ROOT, 'runtime'),
    log,
  };
}

function shotHash(job, shot) {
  return hashParts([
    ENGINE_VERSION,
    `${job.pipeline.name}@${job.pipeline.version}`,
    job.kits.map((k) => `${k.name}@${k.version}`).join(','),
    ...fs.readdirSync(job.runtimeDir).map((f) => ({ file: path.join(job.runtimeDir, f) })),
    ...job.kits.map((k) => ({ file: k.entryPath })),
    ...job.styleScripts.map((f) => ({ file: f })),
    ...job.filmScripts.map((f) => ({ file: f })),
    { file: shot.path },
    { W: job.W, H: job.H, fps: job.fps, seed: job.seed, duration: shot.duration, start: shot.start, id: shot.id },
    job.fonts.css,
    // 只算本镜（及公共脚本）用到的 cue：改一句 VO 不会让无关镜头重渲
    pickCues(job.film.cues, [shot.path, ...job.styleScripts, ...job.filmScripts]),
  ]);
}

async function pipelineModule(job) {
  const mod = await loadModule(job.pipeline);
  const chk = await mod.check();
  if (!chk.ok) throw new Error(`管线 ${job.pipeline.name} 不可用：${chk.missing.join('、')}。${chk.hint || ''}`);
  return mod;
}

/** 渲染所有（或指定）镜头并拼接成一条无声视频，返回其路径。 */
export async function render(filmDir, { proxy = false, only = null, force = false, log = console.log } = {}) {
  const ctx = loadFilm(filmDir);
  const job = createRenderJob(ctx, { proxy, log });
  log(`《${ctx.film.title}》风格 ${ctx.style.id} · 管线 ${job.pipeline.name} · ${job.W}×${job.H} @${job.fps}fps${proxy ? ' (预览)' : ''}`);
  for (const r of job.fonts.report) log(`  字体 ${r}`);

  const cache = new ShotCache(ctx.filmDir);
  const keyOf = (s) => (proxy ? `${s.id}-proxy` : s.id);
  const todo = [];
  const segments = [];
  for (const shot of ctx.shots) {
    const hash = shotHash(job, shot);
    // --only 指定的镜头强制重渲；其余镜头一律走缓存（代码变了的镜头哈希会变，自然会重渲）
    const forced = force || (only && only.includes(shot.id));
    const hit = !forced && cache.lookup(keyOf(shot), hash);
    if (hit) {
      segments.push(hit);
      log(`  ${shot.id} 缓存命中`);
    } else {
      const out = cache.segmentPath(keyOf(shot), hash);
      todo.push({ shot, hash, out });
      segments.push(out);
    }
  }

  if (todo.length) {
    const mod = await pipelineModule(job);
    const t0 = Date.now();
    await mod.renderShots(job, todo, { onDone: ({ shot, hash, out }) => cache.store(keyOf(shot), hash, out) });
    log(`  渲染 ${todo.length} 个镜头用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  const list = path.join(job.workDir, proxy ? 'concat-proxy.txt' : 'concat.txt');
  fs.writeFileSync(list, segments.map((s) => `file '${s}'`).join('\n'));
  const video = path.join(ctx.filmDir, '.cache', proxy ? 'video-proxy.mp4' : 'video.mp4');
  await run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
  log(`  已拼接 → ${path.relative(ctx.filmDir, video)}`);
  return { video, job };
}

/**
 * 渲染静帧。
 * at:    [{shot:'s02', t:1.5}]；省略则每镜取 frames 张（均匀分布）
 * contactSheet: 把所有静帧拼成一张接触表，方便一次看完
 */
export async function stills(filmDir, { at = null, frames = 1, contactSheet = true, proxy = false, log = console.log } = {}) {
  const ctx = loadFilm(filmDir);
  const job = createRenderJob(ctx, { proxy, log });
  const mod = await pipelineModule(job);
  let points = at;
  if (!points) {
    points = [];
    for (const s of ctx.shots) {
      for (let i = 0; i < frames; i++) {
        const t = frames === 1 ? s.duration * 0.6 : (s.duration * (i + 0.5)) / frames;
        points.push({ shot: s.id, t: +t.toFixed(3) });
      }
    }
  }
  const outDir = ensureDir(path.join(ctx.filmDir, 'stills'));
  const files = await mod.renderStills(job, points, outDir);
  log(`  静帧 ${files.length} 张 → stills/`);
  let contactSheetFile = null;
  if (contactSheet && files.length > 1) {
    const cols = Math.min(files.length, frames > 1 ? frames : 3);
    const rows = Math.ceil(files.length / cols);
    contactSheetFile = path.join(outDir, 'sheet.jpg');
    const tw = 640;
    const th = Math.round((tw * job.H) / job.W);
    const inputs = files.flatMap((f) => ['-i', f]);
    if (!hasDrawtext()) log('  ! ffmpeg 不带 drawtext，接触表不加文字标注（按镜头顺序从左到右、从上到下排列）');
    const scaled = files.map((_, i) => `[${i}:v]scale=${tw}:${th}${drawLabel(`${points[i].shot} ${points[i].t}s`)}[v${i}]`).join(';');
    const layout = files.map((_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|');
    const filter = `${scaled};${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=gray`;
    if (files.length === 1) fs.copyFileSync(files[0], contactSheetFile);
    else await run([...inputs, '-filter_complex', filter, '-frames:v', '1', '-q:v', '3', contactSheetFile]);
    log(`  接触表 → ${path.relative(ctx.filmDir, contactSheetFile)} (${cols}×${rows})`);
  }
  return { files, contactSheet: contactSheetFile };
}

const ANIMATIC_FPS = 12;

/** 动态分镜：每镜一张关键帧，按镜头时长停留，叠加 wka soundtrack 混好的声轨，输出 animatic.mp4。 */
export async function animatic(filmDir, { proxy = false, log = console.log } = {}) {
  const ctx = loadFilm(filmDir);
  const { files, contactSheet } = await stills(filmDir, { frames: 1, proxy, log });
  const inputs = files.flatMap((f, i) => ['-loop', '1', '-framerate', String(ANIMATIC_FPS), '-t', String(ctx.shots[i].duration), '-i', f]);
  const audio = path.join(ctx.filmDir, '.cache', 'mix.wav');
  const hasAudio = fs.existsSync(audio);
  if (hasAudio) inputs.push('-i', audio);
  else log('  ! 没有 .cache/mix.wav，动态分镜不带声轨（先运行 wka soundtrack）');
  const filter = files.map((_, i) => `[${i}:v]format=yuv420p${drawLabel(ctx.shots[i].id, { x: 20, y: 20, size: 28 })}[v${i}]`).join(';') + `;${files.map((_, i) => `[v${i}]`).join('')}concat=n=${files.length}:v=1:a=0[v]`;
  const audioArgs = hasAudio ? ['-map', `${files.length}:a`, '-c:a', 'aac', '-b:a', '192k'] : [];
  const out = path.join(ctx.filmDir, 'animatic.mp4');
  await run([...inputs, '-filter_complex', filter, '-map', '[v]', ...audioArgs, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
  log(`  动态分镜 → ${path.relative(ctx.filmDir, out)}（${files.length} 镜 · ${ctx.totalDuration.toFixed(1)}s${hasAudio ? ' · 含声轨' : ''}）`);
  return { file: out, contactSheet, hasAudio };
}

/** 导出：调用 film.json 里声明的各个导出器。 */
export async function encodeOutputs(filmDir, { video, audio, proxy = false, formats = null, log = console.log }) {
  const ctx = loadFilm(filmDir);
  const wanted = formats || ctx.film.export?.formats || ['mp4'];
  const base = ctx.film.export?.name || 'out';
  const outputs = [];
  for (const name of wanted) {
    const exp = ctx.registry.exporters.get(name);
    if (!exp) throw new Error(`导出器 "${name}" 没有注册。可用: ${[...ctx.registry.exporters.keys()].join(', ')}`);
    if (exp.status === 'planned') throw new Error(`导出器 "${name}" 还在规划中`);
    const mod = await loadModule(exp);
    const out = path.join(ctx.filmDir, `${base}${proxy ? '-proxy' : ''}.${exp.ext}`);
    await mod.encodeOutput({ video, audio, out, fps: ctx.film.fps, proxy });
    log(`  导出 ${name} → ${path.relative(ctx.filmDir, out)}`);
    outputs.push(out);
  }
  return outputs;
}
