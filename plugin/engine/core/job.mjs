// 一次渲染任务：读 film.json → 解析风格 → 按镜头调度渲染（带缓存）→ 拼接 → 混音 → 导出。
import fs from 'node:fs';
import path from 'node:path';
import { getRegistry, getStyles, loadModule } from './registry.mjs';
import { resolveStyle } from './resolver.mjs';
import { validate } from './validate.mjs';
import { ShotCache, hashParts } from './cache.mjs';
import { prepareFonts, collectText } from './fonts.mjs';
import { ENGINE_VERSION, ENGINE_ROOT, ensureDir } from './paths.mjs';
import { run, drawLabel } from './ffmpeg.mjs';
import { pickCues } from './cues.mjs';
import { migrateFilm } from './compat.mjs';
import { mergeSubtitleStyle } from './subtitle-layer.mjs';
import { labelPngs } from './labels.mjs';

const PROXY_SPEC = { scale: 0.5, fpsDiv: 2 };

/**
 * @param {{requireShots?: boolean}} [o] requireShots: false 时不检查镜头文件是否存在（声轨这一步还没画镜头）
 */
export function loadFilm(filmDir, { requireShots = true } = {}) {
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
    if (requireShots && !fs.existsSync(shot.path)) throw new Error(`镜头 ${s.id} 的文件不存在: ${s.file}`);
    t += s.duration;
    return shot;
  });

  const styleScripts = (style.scripts || []).map((p) => path.join(style.dir, p));
  const filmScripts = (film.scripts || []).map((p) => path.join(filmDir, p));
  // 片子可以单独改字幕样式（film.json 的 subtitles.style），不用动插件目录里的 style.json
  const filmStyle = film.subtitles?.style ? { ...style, subtitles: mergeSubtitleStyle(style.subtitles, film.subtitles.style) } : style;
  return { film, filmDir, legacyFields, style: filmStyle, registry, ...resolved, shots, totalDuration: t, styleScripts, filmScripts };
}

/** 输出画面的尺寸与帧率：小样为半分辨率、半帧率。 */
export function outputSize(film, proxy = false) {
  const [W0, H0] = film.size;
  const scale = proxy ? PROXY_SPEC.scale : 1;
  return {
    W: Math.round((W0 * scale) / 2) * 2,
    H: Math.round((H0 * scale) / 2) * 2,
    fps: proxy ? Math.max(1, Math.round(film.fps / PROXY_SPEC.fpsDiv)) : film.fps,
  };
}

/** 构建传给管线的任务描述。 */
function createRenderJob(ctx, { proxy = false, log }) {
  const [W0, H0] = ctx.film.size;
  const { W, H, fps } = outputSize(ctx.film, proxy);
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

/** 目录下所有文件（递归、排好序）；目录不存在时为空。 */
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).sort()
    .map((f) => path.join(dir, f))
    .filter((f) => fs.statSync(f).isFile());
}

function shotHash(job, shot) {
  return hashParts([
    ENGINE_VERSION,
    `${job.pipeline.name}@${job.pipeline.version}`,
    job.kits.map((k) => `${k.name}@${k.version}`).join(','),
    ...fs.readdirSync(job.runtimeDir).map((f) => ({ file: path.join(job.runtimeDir, f) })),
    // 管线自己的代码（如 remotion 打进页面的 WkaShot）和风格的静态素材也决定画面
    ...filesUnder(job.pipeline.dir).filter((f) => !f.endsWith('.md')).map((f) => ({ file: f })),
    ...filesUnder(path.join(job.style.dir, 'assets')).map((f) => ({ file: f })),
    ...job.kits.map((k) => ({ file: k.entryPath })),
    ...job.styleScripts.map((f) => ({ file: f })),
    ...job.filmScripts.map((f) => ({ file: f })),
    { file: shot.path },
    { W: job.W, H: job.H, fps: job.fps, seed: job.seed, duration: shot.duration, start: shot.start, id: shot.id },
    job.fonts.css,
    // 只算本镜（及公共脚本）用到的 cue：改一句人声不会让无关镜头重渲
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
  const shotSegments = ctx.shots.map((s, i) => ({ id: s.id, start: s.start, duration: s.duration, file: segments[i] }));
  return { video, job, segments: shotSegments };
}

/** 审阅副本写进片目录的 review/（不隐藏、体积小，聊天和访达里都能直接播放），返回绝对路径。 */
export async function writeReview(filmDir, file, args) {
  const out = path.join(ensureDir(path.join(path.resolve(filmDir), 'review')), file);
  await run([...args, out]);
  return out;
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
  if (contactSheet && files.length) {
    const cols = Math.min(files.length, frames > 1 ? frames : 3);
    const rows = Math.ceil(files.length / cols);
    contactSheetFile = path.join(outDir, 'sheet.jpg');
    const tw = 640;
    const th = Math.round((tw * job.H) / job.W);
    // 标注取自静帧文件名（s02-2.70s.png）：管线按镜头分组渲染，文件顺序和 --at 的顺序可能不同，时间也可能被夹到镜头末尾
    const tags = files.map((f) => path.basename(f, '.png').replace('-', ' '));
    const labels = await labelPngs(tags, { size: 20, workDir: job.workDir, log, what: '接触表' });
    const inputs = [...files, ...(labels || [])].flatMap((f) => ['-i', f]);
    const scaled = files
      .map((_, i) => (labels
        ? `[${i}:v]scale=${tw}:${th}[s${i}];[s${i}][${files.length + i}:v]overlay=10:10[v${i}]`
        : `[${i}:v]scale=${tw}:${th}${drawLabel(tags[i])}[v${i}]`))
      .join(';');
    const layout = files.map((_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|');
    // 只有一张时不拼图，缩放加标注就是接触表
    const filter = files.length === 1
      ? `${scaled};[v0]null`
      : `${scaled};${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=gray`;
    await run([...inputs, '-filter_complex', filter, '-frames:v', '1', '-q:v', '3', contactSheetFile]);
    log(`  接触表 → ${path.relative(ctx.filmDir, contactSheetFile)} (${cols}×${rows})`);
  }
  return { files, contactSheet: contactSheetFile };
}

const ANIMATIC_FPS = 12;

/**
 * 动态分镜：每镜一张关键帧，按镜头时长停留，叠加 wka soundtrack 混好的声轨。
 * 交给用户审的两样都放进 review/：动态分镜.mp4 和接触表.jpg（stills/sheet.jpg 照旧生成）。
 */
export async function animatic(filmDir, { proxy = false, log = console.log } = {}) {
  const ctx = loadFilm(filmDir);
  const { files, contactSheet: sheet } = await stills(filmDir, { frames: 1, proxy, log });
  const reviewDir = ensureDir(path.join(ctx.filmDir, 'review'));
  const contactSheet = sheet ? path.join(reviewDir, '接触表.jpg') : null;
  if (sheet) fs.copyFileSync(sheet, contactSheet);
  const inputs = files.flatMap((f, i) => ['-loop', '1', '-framerate', String(ANIMATIC_FPS), '-t', String(ctx.shots[i].duration), '-i', f]);
  const audio = path.join(ctx.filmDir, '.cache', 'mix.wav');
  const hasAudio = fs.existsSync(audio);
  if (hasAudio) inputs.push('-i', audio);
  else log('  ! 没有 .cache/mix.wav，动态分镜不带声轨（先运行 wka soundtrack）');
  // 标注 PNG 排在图片和声轨之后，声轨的输入序号（files.length）不变
  const labels = await labelPngs(ctx.shots.map((s) => s.id), { size: 28, workDir: path.join(ctx.filmDir, '.cache', 'work'), log, what: '动态分镜' });
  const labelBase = files.length + (hasAudio ? 1 : 0);
  if (labels) inputs.push(...labels.flatMap((f) => ['-i', f]));
  const frame = (i) => (labels
    ? `[${i}:v]format=yuv420p[f${i}];[f${i}][${labelBase + i}:v]overlay=20:20,format=yuv420p[v${i}]`
    : `[${i}:v]format=yuv420p${drawLabel(ctx.shots[i].id, { x: 20, y: 20, size: 28 })}[v${i}]`);
  const filter = files.map((_, i) => frame(i)).join(';') + `;${files.map((_, i) => `[v${i}]`).join('')}concat=n=${files.length}:v=1:a=0[v]`;
  const audioArgs = hasAudio ? ['-map', `${files.length}:a`, '-c:a', 'aac', '-b:a', '192k'] : [];
  const out = path.join(reviewDir, '动态分镜.mp4');
  await run([...inputs, '-filter_complex', filter, '-map', '[v]', ...audioArgs, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
  log(`  动态分镜 → ${path.relative(ctx.filmDir, out)}（${files.length} 镜 · ${ctx.totalDuration.toFixed(1)}s${hasAudio ? ' · 含声轨' : ''}）`);
  return { file: out, contactSheet, hasAudio };
}

/** 导出：调用 film.json 里声明的各个导出器。 */
export async function encodeOutputs(filmDir, { video, audio, timeline = null, proxy = false, formats = null, suffix = '', log = console.log }) {
  const ctx = loadFilm(filmDir);
  const wanted = formats || ctx.film.export?.formats || ['mp4'];
  const base = ctx.film.export?.name || 'out';
  const outputs = [];
  for (const name of wanted) {
    const exp = ctx.registry.exporters.get(name);
    if (!exp) throw new Error(`导出器 "${name}" 没有注册。可用: ${[...ctx.registry.exporters.keys()].join(', ')}`);
    if (exp.status === 'planned') throw new Error(`导出器 "${name}" 还在规划中`);
    const mod = await loadModule(exp);
    const target = path.join(ctx.filmDir, `${base}${suffix}${proxy ? '-proxy' : ''}.${exp.ext}`);
    // 导出器可返回实际产物路径（如写到片目录之外的剪映草稿）
    const out = (await mod.encodeOutput({ video, audio, out: target, fps: ctx.film.fps, proxy, timeline })) || target;
    log(`  导出 ${name} → ${out.startsWith(ctx.filmDir + path.sep) ? path.relative(ctx.filmDir, out) : out}`);
    outputs.push(out);
  }
  return outputs;
}
