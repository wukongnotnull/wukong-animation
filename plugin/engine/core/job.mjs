// 一次渲染任务：读 film.json → 解析风格 → 按镜头调度渲染（带缓存）→ 拼接 → 混音 → 导出。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileDigest, treeEvidence } from './evidence.mjs';
import { digest } from './evidence.mjs';
import { runStage, rememberArtifacts } from './operations.mjs';
import { requireDep, resolveDep } from './deps.mjs';
import { headlessShellFrom } from '../pipelines/remotion/entry.mjs';
import { getRegistry, getStyles, loadModule } from './registry.mjs';
import { resolveStyle } from './resolver.mjs';
import { validate } from './validate.mjs';
import { ShotCache, hashParts, fontCssParts } from './cache.mjs';
import { prepareFonts, collectText } from './fonts.mjs';
import { ENGINE_VERSION, ENGINE_ROOT, ensureDir } from './paths.mjs';
import { run, drawLabel, concatVideo } from './ffmpeg.mjs';
import { pickCues } from './cues.mjs';
import { migrateFilm } from './compat.mjs';
import { mergeSubtitleStyle } from './subtitle-layer.mjs';
import { labelPngs } from './labels.mjs';
import { resolveVariant, overrideShotPath } from './variants.mjs';
import { prepareWordShots, writeWordReview } from './word-sync.mjs';
import { buildFrameTimeline, TIMING_VERSION, assertVideo, recordTiming, timingFailure, requireTiming, checkOutputTiming, checkAnimaticTiming } from './timing.mjs';
import { captureFinalGeneration, recordFinalArtifact } from './final-delivery.mjs';

const PROXY_SPEC = { scale: 0.5, fpsDiv: 2 };

/**
 * @param {{requireShots?: boolean, aspect?: string|null}} [o] requireShots: false 时不检查镜头文件是否存在（声轨这一步还没画镜头）；
 *   aspect: 要处理的画幅，缺省为主版。副版换成副版尺寸、优先用覆盖镜头文件 sNN.<后缀>.<扩展名>
 */
export function loadFilm(filmDir, { requireShots = true, aspect = null } = {}) {
  filmDir = path.resolve(filmDir);
  const file = path.join(filmDir, 'film.json');
  if (!fs.existsSync(file)) throw new Error(`找不到 ${file}`);
  const { film: rawFilm, renamed: legacyFields } = migrateFilm(JSON.parse(fs.readFileSync(file, 'utf8')));
  const errs = validate('film', rawFilm, 'film.json');
  if (errs.length) throw new Error('film.json 校验失败:\n  ' + errs.join('\n  '));

  const registry = getRegistry();
  const { styles } = getStyles();
  const style = styles.get(rawFilm.style);
  if (!style) throw new Error(`film.json 使用的风格 "${rawFilm.style}" 不存在。可用: ${[...styles.keys()].join(', ')}`);
  const resolved = resolveStyle(style, registry);
  if (resolved.errors.length) throw new Error('风格解析失败:\n  ' + resolved.errors.join('\n  '));

  const variant = resolveVariant({ film: rawFilm, style, filmDir }, aspect);
  const film = variant.isMain ? rawFilm : { ...rawFilm, size: variant.size };

  let t = 0;
  const shots = film.shots.map((s) => {
    const shot = { ...s, start: t, path: overrideShotPath(path.join(filmDir, s.file), variant.suffix) };
    if (requireShots && !fs.existsSync(shot.path)) throw new Error(`镜头 ${s.id} 的文件不存在: ${s.file}`);
    t += s.duration;
    return shot;
  });

  const styleScripts = (style.scripts || []).map((p) => path.join(style.dir, p));
  const filmScripts = (film.scripts || []).map((p) => path.join(filmDir, p));
  // 片子可以单独改字幕样式（film.json 的 subtitles.style），副版还能再覆盖一层；不用动插件目录里的 style.json
  const { by_aspect: byAspect = {}, ...baseSubtitles } = style.subtitles || {};
  const resolvedSubtitles = [byAspect[variant.aspect],film.subtitles?.style,variant.overrides.subtitles?.style].filter(Boolean)
    .reduce((acc,o)=>mergeSubtitleStyle(acc,o),baseSubtitles);
  const filmStyle = { ...style, subtitles: resolvedSubtitles };
  return { film, filmDir, legacyFields, style: filmStyle, registry, ...resolved, shots, totalDuration: t, styleScripts, filmScripts, variant };
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
  const timeline = buildFrameTimeline(ctx.shots, fps);
  const native = buildFrameTimeline(ctx.shots, ctx.film.fps);
  const shots = ctx.shots.map((s, i) => ({ ...s, frames: timeline.shots[i].frames, nativeFrames: native.shots[i].frames, startFrame: timeline.shots[i].startFrame }));
  const workDir = ensureDir(path.join(ctx.variant.cacheDir, 'work'));
  const text = collectText([...ctx.shots.map((s) => s.path), ...ctx.filmScripts]);
  const fonts = prepareFonts(ctx.style.fonts || [], { text, workDir, log });
  return prepareWordShots({
    ...ctx,
    shots, timeline,
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
  });
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
    { W: job.W, H: job.H, fps: job.fps, seed: job.seed, duration: shot.duration, start: shot.start, id: shot.id, timingVersion: TIMING_VERSION, frames: shot.frames, nativeFrames: shot.nativeFrames, startFrame: shot.startFrame },
    ...fontCssParts(job.fonts.css),
    // 只算本镜（及公共脚本）用到的 cue：改一句人声不会让无关镜头重渲
    pickCues(job.film.cues, [shot.path, ...job.styleScripts, ...job.filmScripts]),
    pickCues(job.wordEvidence, [shot.path, ...job.styleScripts, ...job.filmScripts]),
    pickCues(shot.wordFrames, [shot.path, ...job.styleScripts, ...job.filmScripts]),
  ]);
}

/** 各镜头当前的缓存哈希 { 镜头 id: 哈希 }（全分辨率），签批时记进进度，用来判断镜头后来有没有动过。 */
export function shotHashes(filmDir, { aspect = null, log = () => {} } = {}) {
  const ctx = loadFilm(filmDir, { aspect });
  const job = createRenderJob(ctx, { log });
  return Object.fromEntries(job.shots.map((s) => [s.id, shotHash(job, s)]));
}

/** 实际验证环境；缺少可核验的渲染器时不复用跨调用的画面证明。 */
export function mainCheckConditions(filmDir) {
  const ctx=loadFilm(filmDir),job=createRenderJob(ctx,{log:()=>{}});
  try {
    const exe=requireDep('playwright').chromium.executablePath();
    const shell=headlessShellFrom(exe,fs);
    const browser=[...new Set([exe,shell].filter(Boolean))].map(file=>({file,sha256:fileDigest(file)}));
    const packages=['playwright',...(ctx.pipeline.name==='remotion'?['remotion','@remotion/renderer','@remotion/bundler','react']:[])].map(name=>({name,sha256:fileDigest(path.join(resolveDep(name),'package.json'))}));
    const commands=['ffmpeg','ffprobe'].map(name=>{
      const r=spawnSync(name,['-version'],{encoding:'utf8'});
      if(r.status!==0) throw new Error(name+'不可用');
      return r.stdout;
    });
    const fontDirs=process.platform==='darwin'?['/System/Library/Fonts','/Library/Fonts',path.join(os.homedir(),'Library/Fonts')]:['/usr/share/fonts','/usr/local/share/fonts',path.join(os.homedir(),'.fonts'),path.join(os.homedir(),'.local/share/fonts')];
    return {platform:[process.platform,process.arch,os.release(),process.version],browser,packages,commands,
      fonts:fontCssParts(job.fonts.css).map(p=>p?.file?{name:path.basename(p.file),sha256:fileDigest(p.file)}:p),fontState:job.fonts.report,
      systemFonts:fontDirs.map(dir=>[dir,treeEvidence(dir)]),
      engine:treeEvidence(ENGINE_ROOT,(rel,ent)=>ent.isDirectory()&&['node_modules','.cache'].includes(ent.name)),
      size:ctx.film.size, fps:ctx.film.fps, timeline:job.timeline};
  } catch { return null; }
}

async function pipelineModule(job) {
  const mod = await loadModule(job.pipeline);
  const chk = await mod.check();
  if (!chk.ok) throw new Error(`管线 ${job.pipeline.name} 不可用：${chk.missing.join('、')}。${chk.hint || ''}`);
  return mod;
}

/** 渲染所有（或指定）镜头并拼接成一条无声视频，返回其路径。 */
export async function render(filmDir, { proxy = false, only = null, force = false, aspect = null, segmentsOnly = false, log = console.log } = {}) {
  const ctx = loadFilm(filmDir, { aspect });
  const job = createRenderJob(ctx, { proxy, log });
  log(`[${ctx.variant.aspect} ${proxy?'小样':'高清'} · segments] 开始`);
  log(`《${ctx.film.title}》${ctx.variant.isMain ? '' : `${ctx.variant.aspect} 副版 · `}风格 ${ctx.style.id} · 管线 ${job.pipeline.name} · ${job.W}×${job.H} @${job.fps}fps${proxy ? ' (预览)' : ''}`);
  for (const r of job.fonts.report) log(`  字体 ${r}`);

  const cache = new ShotCache(ctx.filmDir, ctx.variant.cacheDir);
  const keyOf = (s) => (proxy ? `${s.id}-proxy` : s.id);
  const todo = [];
  const segments = [];
  for (const shot of job.shots) {
    const hash = shotHash(job, shot);
    // --only 指定的镜头强制重渲；其余镜头一律走缓存（代码变了的镜头哈希会变，自然会重渲）
    const forced = force || (only && only.includes(shot.id));
    const hit = !forced && cache.lookup(keyOf(shot), hash);
    if (hit) {
      try { assertVideo(hit, { fps: job.fps, frames: shot.frames }); }
      catch (e) {
        cache.invalidate(keyOf(shot));
        timingFailure(ctx, new Error(`${shot.id}：${e.message}；请重渲此镜头`), { proxy, log });
        throw e;
      }
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
    try {
      await mod.renderShots(job, todo, { onDone: ({ shot, hash, out }) => {
        assertVideo(out, { fps: job.fps, frames: shot.frames });
        cache.store(keyOf(shot), hash, out);
      } });
    } catch (e) {
      timingFailure(ctx, e, { proxy, log });
      throw e;
    }
    log(`  渲染 ${todo.length} 个镜头用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  const list = path.join(job.workDir, proxy ? 'concat-proxy.txt' : 'concat.txt');
  const video = path.join(ctx.variant.cacheDir, proxy ? 'video-proxy.mp4' : 'video.mp4');
  const shotSegments = job.timeline.shots.map((s, i) => ({ id: s.id, start: s.startFrame / job.fps, duration: s.frames / job.fps, file: segments[i] }));
  rememberArtifacts(ctx.filmDir,{stage:'segments',aspect:ctx.variant.aspect,proxy,signature:digest(shotHashes(ctx.filmDir,{aspect})),value:shotSegments,outputs:segments});
  if(segmentsOnly) return {video:null,job,segments:shotSegments};
  try {
    await runStage(ctx.filmDir,{stage:'concat',aspect:ctx.variant.aspect,proxy,force:force||!!only,signature:digest({fps:job.fps,segments:segments.map(file=>fileDigest(file))}),log,
      run:async()=>{await concatVideo(segments,{fps:job.fps,list,out:video});return {value:video,outputs:[video]};},
      validate:file=>{try{assertVideo(file,{fps:job.fps,frames:job.timeline.totalFrames});return true;}catch{return false;}}});
  } catch (e) {
    timingFailure(ctx, e, { proxy, log });
    throw e;
  }
  recordTiming(ctx, video, segments, { proxy, log });
  await writeWordReview(job, { video });
  log(`  已拼接 → ${path.relative(ctx.filmDir, video)}`);
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
export async function stills(filmDir, { at = null, frames = 1, contactSheet = true, proxy = false, aspect = null, log = console.log } = {}) {
  const ctx = loadFilm(filmDir, { aspect });
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
  const outDir = ensureDir(ctx.variant.stillsDir);
  const files = await mod.renderStills(job, points, outDir);
  await writeWordReview(job, { renderStills: (points, dir) => mod.renderStills(job, points, dir) });
  log(`  静帧 ${files.length} 张 → ${path.relative(ctx.filmDir, outDir)}/`);
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
 * 动态分镜：每镜一张代表帧，按镜头时长停留，叠加 wka soundtrack 混好的声轨。
 * 交给用户审的两样都放进 review/：动态分镜.mp4 和接触表.jpg（stills/sheet.jpg 照旧生成）。
 */
export async function animatic(filmDir, { proxy = false, aspect = null, log = console.log } = {}) {
  const ctx = loadFilm(filmDir, { aspect });
  const timeline = buildFrameTimeline(ctx.shots, ANIMATIC_FPS);
  const { files, contactSheet: sheet } = await stills(filmDir, { frames: 1, proxy, aspect, log });
  const reviewDir = ensureDir(path.join(ctx.filmDir, 'review'));
  const contactSheet = sheet ? path.join(reviewDir, ctx.variant.review('接触表.jpg')) : null;
  if (sheet) fs.copyFileSync(sheet, contactSheet);
  const inputs = files.flatMap((f, i) => ['-loop', '1', '-framerate', String(ANIMATIC_FPS), '-t', String((timeline.shots[i].frames + 1) / ANIMATIC_FPS), '-i', f]);
  const audio = path.join(ctx.filmDir, '.cache', 'mix.wav');
  const hasAudio = fs.existsSync(audio);
  if (hasAudio) inputs.push('-i', audio);
  else log('  ! 没有 .cache/mix.wav，动态分镜不带声轨（先运行 wka soundtrack）');
  // 标注 PNG 排在图片和声轨之后，声轨的输入序号（files.length）不变
  const labels = await labelPngs(ctx.shots.map((s) => s.id), { size: 28, workDir: path.join(ctx.variant.cacheDir, 'work'), log, what: '动态分镜' });
  const labelBase = files.length + (hasAudio ? 1 : 0);
  if (labels) inputs.push(...labels.flatMap((f) => ['-i', f]));
  const frame = (i) => (labels
    ? `[${i}:v]trim=end_frame=${timeline.shots[i].frames},setpts=PTS-STARTPTS,format=yuv420p[f${i}];[f${i}][${labelBase + i}:v]overlay=20:20,format=yuv420p[v${i}]`
    : `[${i}:v]trim=end_frame=${timeline.shots[i].frames},setpts=PTS-STARTPTS,format=yuv420p${drawLabel(ctx.shots[i].id, { x: 20, y: 20, size: 28 })}[v${i}]`);
  const filter = files.map((_, i) => frame(i)).join(';') + `;${files.map((_, i) => `[v${i}]`).join('')}concat=n=${files.length}:v=1:a=0[v]`;
  const audioArgs = hasAudio ? ['-map', `${files.length}:a`, '-c:a', 'aac', '-b:a', '192k'] : [];
  const out = path.join(reviewDir, ctx.variant.review('动态分镜.mp4'));
  await run([...inputs, '-filter_complex', filter, '-map', '[v]', ...audioArgs, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
  checkAnimaticTiming(ctx, out, timeline, log);
  log(`  动态分镜 → ${path.relative(ctx.filmDir, out)}（${files.length} 镜 · ${ctx.totalDuration.toFixed(1)}s${hasAudio ? ' · 含声轨' : ''}）`);
  return { file: out, contactSheet, hasAudio };
}

/** 导出：调用 film.json 里声明的各个导出器。 */
export async function encodeOutputs(filmDir, { video, audio, timeline = null, proxy = false, formats = null, suffix = '', aspect = null, force = false, fontFiles = [], unknownReasons = [], log = console.log }) {
  const ctx = loadFilm(filmDir, { aspect });
  const wanted = formats || ctx.film.export?.formats || ['mp4'];
  if(wanted.some(f=>f!=='jianying')) requireTiming(ctx,{proxy});
  else {
    if(!timeline) throw new Error('草稿需要可验证时间线');
    const frames=buildFrameTimeline(ctx.shots,outputSize(ctx.film,proxy).fps);
    for(const s of frames.shots) assertVideo(timeline.shots.find(t=>t.id===s.id)?.file,{fps:frames.fps,frames:s.frames});
  }
  const base = ctx.variant.exportName;
  const outputs = [];
  for (const name of wanted) {
    const exp = ctx.registry.exporters.get(name);
    if (!exp) throw new Error(`导出器 "${name}" 没有注册。可用: ${[...ctx.registry.exporters.keys()].join(', ')}`);
    if (exp.status === 'planned') throw new Error(`导出器 "${name}" 还在规划中`);
    const mod = await loadModule(exp);
    const target = path.join(ctx.filmDir, `${base}${suffix}${proxy ? '-proxy' : ''}.${exp.ext}`);
    let generation=null;
    if(!proxy)try {
      const kind=name==='jianying'?'draft':'video',flavor=kind==='video'?(suffix.includes('有字幕')?'burned':'clean'):null;
      const slot=[ctx.variant.aspect,kind,name,...(flavor?[flavor]:[])].join('/'),projection={slot,name:base,...(kind==='draft'?{title:ctx.variant.title}:{}),...(kind==='video'?{size:ctx.film.size,fps:ctx.film.fps}:{}),...(flavor==='burned'?{bilingual:!!ctx.film.subtitles?.bilingual}:{})};
      generation=captureFinalGeneration(ctx.filmDir,{slot,fontFiles,unknownReasons,inputFiles:[audio,...(timeline?[...timeline.shots,...timeline.tracks].map(t=>t.file):[])].filter(Boolean),descriptor:{slot,aspect:ctx.variant.aspect,kind,format:name,flavor,projection,contractDigest:digest(projection)}});
    }catch(e){log(`  ! 交付来源未取证，保留导出任务：${e.message}`);}
    // 导出器可返回实际产物路径（如写到片目录之外的剪映草稿）
    const signature=digest({target,draftRoot:name==='jianying'?(process.env.WKA_JIANYING_DRAFTS||path.join(os.homedir(),'Movies/JianyingPro/User Data/Projects/com.lveditor.draft')):null,video:video&&fileDigest(video),audio:audio&&fileDigest(audio),timeline,inputs:timeline?[...timeline.shots,...timeline.tracks].map(t=>[t.file,fileDigest(t.file)]):[],exporter:treeEvidence(exp.dir),name,suffix,proxy,settings:ctx.film.export});
    const out=await runStage(ctx.filmDir,{stage:name==='jianying'?'draft-export':`encode:${name}${suffix}`,aspect:ctx.variant.aspect,proxy,signature,force,log,
      run:async()=>{const out=(await mod.encodeOutput({video,audio,out:target,fps:outputSize(ctx.film,proxy).fps,duration:buildFrameTimeline(ctx.shots,outputSize(ctx.film,proxy).fps).duration,proxy,timeline,force}))||target;return {value:out,outputs:[out]};}});
    if (name === 'mp4') checkOutputTiming(ctx, out, { proxy, log });
    if(generation)try{recordFinalArtifact(ctx.filmDir,{generation,path:out,stage:name==='jianying'?'draft-export':`encode:${name}${suffix}`,technical:{status:['mp4','jianying'].includes(name)?'passed':'unknown',checks:name==='jianying'?['native writer 时间线及素材校验']:name==='mp4'?['实际输出时间轴校验']:[],errors:[]}});}catch(e){log(`  ! 产物已生成，交付证据未存档，待核实；可 delivery --final --record 重试：${e.message}`);}
    log(`  导出 ${name} → ${out.startsWith(ctx.filmDir + path.sep) ? path.relative(ctx.filmDir, out) : out}`);
    outputs.push(out);
  }
  return outputs;
}
