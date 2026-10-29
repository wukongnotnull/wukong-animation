#!/usr/bin/env node
// wka —— wukong-animation 引擎命令行。
//   wka setup                         安装依赖到 ~/.wukong-animation/deps/<版本>/
//   wka check                         检查环境与所有插槽
//   wka list [styles|pipelines|kits|exporters]
//   wka init-project [目录]           git 初始化工程（第 1 道工序）
//   wka brief <片名> [--dir 项目目录]  建占位片目录和简报空白稿（第 2 道工序）
//   wka init <片名> --style <id> [--dir 项目目录] [--aspect 16:9|9:16]
//   wka new style <id> --name 名称 [--category 分类] [--order N] [--dest 目录]   新建风格（默认 ~/.wukong-animation/styles/）
//   wka status [项目目录]             各片制作进度（恢复在制项目）
//   wka resume <片目录> [--json]       核实已完成产物、失败阶段和待存档签批
//   wka delivery <片目录> --host codex|claude|generic [--aspect all|9:16] [--json]  生成存在性与新旧状态交付清单
//   wka signoff <片目录> "<审片结论>" [--step N]   审片节点签批：记录进度并做定版快照
//   wka qc <片目录> [--proxy] [--aspect 9:16]       量化技术质检（QC）
//   wka still <片目录> [--frames N] [--at s02:1.5,s03:2] [--proxy] [--aspect 9:16]   静帧 + 接触表
//   wka animatic <片目录> [--proxy] [--aspect 9:16]   动态分镜：代表帧按镜头时长排成粗片并配上声轨
//   wka render <片目录> [--proxy] [--only s01,s03] [--force] [--aspect 9:16]   渲染（--proxy 为小样；--aspect 出副版）
//   wka soundtrack <片目录>           声轨制作：配乐 + 人声，写入声音同步点（不要求镜头文件已写好）
//   wka sfx <片目录> [--list]         录音音效：--list 只列来源与大小（给用户确认），不带参数则下载并处理
//   wka audition <片目录> [--voices a,b,c] [--text "…"] [--rate -20%] [--pitch -2Hz]   音色试听：同一句用几个音色各合成一遍
//   wka subtitles <片目录> [--force] [--preview|--preflight] [--aspect 9:16]   字幕制作：从人声生成 subtitles.srt；--preview 烧录到小样上审阅
//   wka final <片目录> [--proxy] [--only ...] [--formats mp4,gif] [--aspect 9:16|all]   终版渲染与终混
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { getRegistry, getStyles, loadModule } from '../core/registry.mjs';
import { ENGINE_VERSION, ENGINE_ROOT, PLUGIN_ROOT, DEPS_DIR, HOME, TEMPLATES_DIR, USER_STYLES_DIR, ensureDir } from '../core/paths.mjs';
import { copyTemplate, NAME_RE } from '../core/scaffold.mjs';
import { render, stills, animatic, encodeOutputs, loadFilm, outputSize, writeReview, shotHashes } from '../core/job.mjs';
import { snapshotMain, checkMainUnchanged } from '../core/approval.mjs';
import { listAspects } from '../core/variants.mjs';
import { initProject, commitSnapshot, hasGit } from '../core/project.mjs';
import { hasFfmpeg, generatedMixPadding } from '../core/ffmpeg.mjs';
import { detectTtsEngine } from '../audio/tts.mjs';
import { resolveStyle } from '../core/resolver.mjs';
import { recordProgress, readProgress, variantStale, staleVariants, listProductions, PRODUCTION_STEPS, REVIEW_GATES, LAST_STEP, commitSignoff } from '../core/state.mjs';
import { runQc } from '../core/qc.mjs';
import {preflightSubtitles,requireSubtitlePreflight} from '../core/subtitle-preflight.mjs';
import { requireTiming, checkOutputTiming } from '../core/timing.mjs';
import { checkShotSizes } from '../core/shot-sizes.mjs';
import { buildSubtitles, formatSrt, parseSrt, checkSubtitles, subtitleSettings, subtitleOutputs, syncEnglish, checkEnglish, englishSrt, splitEnglishForVariant } from '../core/subtitles.mjs';
import { burnSubtitles, subtitleStyle } from '../core/subtitle-layer.mjs';
import { parseArgs } from './args.mjs';
import { runStage, lockProduction, recoveryStatus,rememberArtifacts,implementationState } from '../core/operations.mjs';
import { writeDelivery,readDecisions,decisionConflicts } from '../core/delivery.mjs';
import { draftAudioDifference } from '../core/review-evidence.mjs';
import { digest, fileDigest, readJson, atomicJson,treeEvidence } from '../core/evidence.mjs';

const SHOT_SIZE_STEP = 5; // 第 5 道「分镜脚本」
const FINAL_REVIEW_STEP = 13; // 第 13 道「终检与交付」：主版定稿
const VARIANT_STEP = 14; // 第 14 道「改版」：副版定稿
const { cmd, pos, opt } = parseArgs(process.argv.slice(2));
const log = (...a) => console.log(...a);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
/** --aspect：要处理的画幅（副版），缺省为主版 */
const aspectOpt = () => {
  if (opt('aspect') === true) fail('--aspect 后面要写画幅，如 --aspect 9:16（final 还可以写 all）');
  return typeof opt('aspect') === 'string' ? opt('aspect') : null;
};

const STYLE_SCHEMA = path.join(ENGINE_ROOT, 'schemas', 'style.schema.json');
// 插件外的风格（用户目录等）找不到插件里的 schema，编辑器改用仓库 main 分支上的这份
const STYLE_SCHEMA_URL = 'https://raw.githubusercontent.com/wukongnotnull/wukong-animation/main/plugin/engine/schemas/style.schema.json';

const CATS = { dongfang: '东方神韵', shouhui: '手绘绘画', pingmian: '平面排版', katong: '卡通漫画', youxi: '游戏数字', dianying: '电影年代', caizhi: '材质 3D', xinxi: '信息叙事', custom: '自定义' };

async function cmdCheck() {
  log(`wukong-animation 引擎 ${ENGINE_VERSION}  ·  Node ${process.version}`);
  log(`  插件目录 ${PLUGIN_ROOT}`);
  log(`  用户目录 ${HOME}`);
  const reg = getRegistry();
  let bad = 0;
  log('\n基础工具');
  const tools = [
    ['ffmpeg', hasFfmpeg(), '必需：编码与混音'],
    ['git', hasGit(), '推荐：项目版本管理'],
    ['python3 + fonttools', spawnSync('python3', ['-c', 'import fontTools'], { stdio: 'ignore' }).status === 0, '推荐：中文字体子集化'],
    ['pyJianYingDraft', spawnSync('python3', ['-c', 'import pyJianYingDraft'], { stdio: 'ignore' }).status === 0, '可选：导出剪映草稿（pip install pyJianYingDraft==0.3.1）'],
  ];
  for (const [n, ok, why] of tools) log(`  ${ok ? '✓' : '✗'} ${n.padEnd(20)} ${why}`);
  if (!tools[0][1]) bad++;
  const tts = detectTtsEngine();
  log(`  ${tts.length ? '✓' : '·'} TTS                  ${tts.length ? tts.join(', ') : '未安装（可选：kokoro / edge-tts）'}`);

  log('\n管线');
  for (const p of reg.pipelines.values()) {
    if (p.status === 'planned') {
      log(`  · ${p.name.padEnd(10)} 规划中`);
      continue;
    }
    const r = await (await loadModule(p)).check();
    log(`  ${r.ok ? '✓' : '✗'} ${p.name.padEnd(10)} ${r.ok ? p.status : '缺少 ' + r.missing.join('、')}`);
    if (!r.ok) bad++;
  }
  log('\n工具包');
  for (const k of reg.kits.values()) log(`  ${k.status === 'planned' ? '·' : '✓'} ${k.name.padEnd(10)} ${k.version.padEnd(7)} ${k.status}`);
  log('\n导出器');
  for (const e of reg.exporters.values()) log(`  ✓ ${e.name.padEnd(10)} .${e.ext}`);
  const { styles, problems } = getStyles();
  const usable = [...styles.values()].filter((s) => resolveStyle(s, reg).errors.length === 0);
  log(`\n风格  ${usable.length} 个可用 / ${styles.size} 个已登记`);
  const all = [...reg.problems, ...problems];
  if (all.length) {
    log('\n问题');
    for (const p of all) log(`  ✗ ${p}`);
    bad += all.length;
  }
  log(bad ? `\n有 ${bad} 项需要处理。依赖缺失请运行 /wukong-animation:setup` : '\n一切就绪 ✓');
  return bad;
}

function cmdSetup() {
  ensureDir(DEPS_DIR);
  const pkg = JSON.parse(fs.readFileSync(path.join(ENGINE_ROOT, 'package.json'), 'utf8'));
  fs.writeFileSync(
    path.join(DEPS_DIR, 'package.json'),
    JSON.stringify({ name: 'wukong-animation-deps', private: true, dependencies: pkg.dependencies }, null, 2)
  );
  log(`安装 npm 依赖到 ${DEPS_DIR} …`);
  const npm = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: DEPS_DIR, stdio: 'inherit' });
  if (npm.status !== 0) fail('npm install 失败，请检查网络后重试');
  log('安装 Chromium …');
  const pw = spawnSync('npx', ['playwright', 'install', 'chromium'], { cwd: DEPS_DIR, stdio: 'inherit' });
  if (pw.status !== 0) fail('Chromium 安装失败');
  if (!hasFfmpeg()) log('! 还缺 ffmpeg：macOS 用 brew install ffmpeg，Ubuntu 用 sudo apt install ffmpeg');
  if (!hasGit()) log('! 推荐安装 git，用于为每个审片节点做定版存档');
  if (spawnSync('python3', ['-c', 'import fontTools'], { stdio: 'ignore' }).status !== 0) {
    log('! 推荐：pip install fonttools brotli（中文字体子集化，渲染更快、体积更小）');
  }
  log('完成。运行 wka check 确认。');
}

function cmdList(what = 'styles') {
  const reg = getRegistry();
  if (what === 'styles') {
    const { styles } = getStyles();
    const rows = [...styles.values()].sort((a, b) => a.order - b.order);
    for (const s of rows) {
      const ok = resolveStyle(s, reg).errors.length === 0;
      log(`${String(s.order).padStart(2, '0')}  ${s.id.padEnd(18)} ${s.name.padEnd(8)} ${(CATS[s.category] || s.category).padEnd(6)} ${s.pipeline}/${Object.keys(s.kits).join('+')}${ok ? '' : '  (不可用)'}${s.origin === 'user' ? '  [用户]' : ''}`);
    }
    if (!rows.length) log('（还没有风格）');
    return;
  }
  const map = { pipelines: reg.pipelines, kits: reg.kits, exporters: reg.exporters }[what];
  if (!map) fail(`未知类别 ${what}`);
  for (const x of map.values()) log(`${x.name.padEnd(12)} ${x.version.padEnd(7)} ${x.status.padEnd(12)} ${x.description}`);
}

function cmdInit(name, { style, dir = '.', aspect = '16:9' }) {
  if (!name) fail('用法：wka init <片名> --style <id>');
  const { styles } = getStyles();
  const st = styles.get(style);
  if (!st) fail(`没有风格 "${style}"。可用：${[...styles.keys()].join(', ')}`);
  const filmDir = path.resolve(dir, 'films', name);
  if (fs.existsSync(path.join(filmDir, 'film.json'))) fail(`${filmDir} 已存在`);
  const tpl = path.join(TEMPLATES_DIR, 'film');
  fs.cpSync(tpl, filmDir, { recursive: true });
  const size = aspect === '9:16' ? [1080, 1920] : aspect === '1:1' ? [1080, 1080] : [1920, 1080];
  const film = JSON.parse(fs.readFileSync(path.join(filmDir, 'film.json'), 'utf8'));
  Object.assign(film, { title: name, style: st.id, size, fps: st.fps });
  // 模板里两种镜头写法都有：remotion 管线用 React 组件（.tsx），其余用 wk.shot（.js）
  const ext = st.pipeline === 'remotion' ? 'tsx' : 'js';
  fs.rmSync(path.join(filmDir, 'shots', ext === 'tsx' ? 's01.js' : 's01.tsx'), { force: true });
  film.shots = film.shots.map((s) => ({ ...s, file: s.file.replace(/\.js$/, `.${ext}`) }));
  fs.writeFileSync(path.join(filmDir, 'film.json'), JSON.stringify(film, null, 2) + '\n');
  log(`✓ 已创建 ${path.relative(process.cwd(), filmDir) || '.'}（风格 ${st.name} · ${size.join('×')} @${st.fps}fps）`);
  log(`  风格文档：${path.join(st.dir, 'STYLE.md')}`);
  log(`  技术文档：${path.join(st.dir, 'TECH.md')}`);
}

/** 制作简报（第 2 道）：建占位片目录和 brief.md 空白稿；第 3 道 wka init 在这个目录上补齐工程。 */
function cmdBrief(name, { dir = '.' }) {
  if (!name) fail('用法：wka brief <片名> [--dir 项目目录]');
  const filmDir = path.resolve(dir, 'films', name);
  const brief = path.join(filmDir, 'brief.md');
  if (fs.existsSync(brief)) fail(`${brief} 已存在`);
  const tpl = fs.readFileSync(path.join(TEMPLATES_DIR, 'brief.md'), 'utf8');
  fs.mkdirSync(filmDir, { recursive: true });
  fs.writeFileSync(brief, tpl.replaceAll('<片名>', name));
  recordProgress(filmDir, { step: 1, note: '建立占位片目录' });
  log(`✓ 已创建 ${path.relative(process.cwd(), brief) || brief}`);
}

/** 新建风格：从引擎模板复制，默认放用户目录（升级插件不覆盖）；维护者用 --dest plugin/skills。 */
function cmdNew(what, id, { name, category = 'custom', order = 101, dest = USER_STYLES_DIR }) {
  if (what !== 'style') fail('wka new 只支持 style（工具包、管线、导出器要在插件仓库里实现）');
  if (!id || !NAME_RE.test(id) || !name || name === true) fail('用法：wka new style <id> --name 名称 [--category 分类] [--order N] [--dest 目录]（id 只用小写字母、数字和连字符）');
  if (!/^\d+$/.test(String(order)) || Number(order) < 1 || Number(order) > 999) fail(`--order 要是 1–999 的整数，收到 "${order}"`);
  const dir = path.resolve(dest, id);
  if (fs.existsSync(dir)) fail(`${dir} 已存在`);
  const inPlugin = !path.relative(PLUGIN_ROOT, dir).startsWith('..');
  copyTemplate(path.join(TEMPLATES_DIR, 'style-skill'), dir, {
    ID: id,
    NAME: name,
    CATEGORY: category,
    ORDER: Number(order),
    SCHEMA: inPlugin ? path.relative(dir, STYLE_SCHEMA).split(path.sep).join('/') : STYLE_SCHEMA_URL,
    GLOBAL: id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()),
    ONE_LINE: '（一句话特征）',
    WHEN: '（什么样的片子）',
  });
  log(`✓ 已创建 ${dir}（第 ${order} 变）`);
  log('  下一步：写 STYLE.md 十节 → TECH.md → scripts/style.js → examples/ 示范片 → wka list styles 校验');
}

/** 读字幕文件并检查；有错误就中断，警告打印后继续。 */
function readSubtitles(ctx, settings, { missing }) {
  const file = path.join(ctx.filmDir, settings.file);
  if (!fs.existsSync(file)) fail(missing);
  const subs = parseSrt(fs.readFileSync(file, 'utf8'));
  reportSubtitleCheck(ctx, settings, subs);
  return subs;
}

/** 片目录里的英文稿；没有时为 null。 */
function readEnglish(ctx, settings) {
  const file = path.join(ctx.filmDir, settings.enFile);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`${settings.enFile} 不是合法的 JSON：${e.message}`);
  }
}

/** 双语：按中文字幕重排英文稿（保留能对上的英文），内容变了才写文件，报待填条目。 */
function syncEnglishFile(ctx, settings, subs, {force=false}={}) {
  const file = path.join(ctx.filmDir, settings.enFile);
  let pairs;
  try {
    pairs = syncEnglish(subs, readEnglish(ctx, settings));
  } catch (e) {
    fail(e.message);
  }
  if (fs.existsSync(file) && !force) {
    log(`· 已有 ${settings.enFile}，未覆盖手改；如需按当前字幕重排请显式使用 --force`);
    const kept=readEnglish(ctx,settings);
    log(`✓ 英文字幕 ${kept.length} 条，其中 ${kept.filter(p=>!String(p.en || '').trim()).length} 条待填 → ${settings.enFile}`);
    for(const w of checkEnglish(kept,{maxChars:settings.maxCharsEn})) log('  ! '+w);
    return;
  }
  const text = JSON.stringify(pairs, null, 1) + '\n';
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
  const pending = pairs.flatMap((p, i) => (p.en.trim() ? [] : [`第 ${i + 1} 条「${p.zh}」`]));
  log(`✓ 英文字幕 ${pairs.length} 条，其中 ${pending.length} 条待填 → ${settings.enFile}`);
  for (const p of pending) log(`  · ${p}`);
  for (const w of checkEnglish(pairs, { maxChars: settings.maxCharsEn })) log(`  ! ${w}`);
}

function reportSubtitleCheck(ctx, settings, subs) {
  const { errors, warnings } = checkSubtitles(subs, { duration: ctx.totalDuration, maxChars: settings.maxChars, protectedTerms: settings.protectedTerms });
  for (const w of warnings) log(`  ! ${w}`);
  if (errors.length) fail(`${settings.file} 有错误：\n  ${errors.join('\n  ')}`);
}

/** 副版英文稿：沿用主版英文，按副版的中文拆条重新切开（不重译）。 */
function writeVariantEnglish(ctx, settings, subs) {
  const main = loadFilm(ctx.filmDir);
  const mainSettings = subtitleSettings(main.film, main.variant);
  const mainSubs = readSubtitles(main, mainSettings, { missing: `副版英文沿用主版：先做主版字幕（wka subtitles ${ctx.filmDir}）` });
  const mainPairs = readEnglish(main, mainSettings);
  if (!mainPairs) fail(`副版英文沿用主版：还没有 ${mainSettings.enFile}，先做主版字幕`);
  const audio = ctx.film.audio || {};
  const pairs = splitEnglishForVariant({ voices: audio.voices || [], cues: ctx.film.cues || {}, mainSubs, mainPairs, variantSubs: subs, protectedTerms: settings.protectedTerms });
  fs.writeFileSync(path.join(ctx.filmDir, settings.enFile), JSON.stringify(pairs, null, 1) + '\n');
  log(`✓ 副版英文按主版英文重新拆条 → ${settings.enFile}`);
}

/** 录音音效（第 7 道声轨制作用）：--list 只列来源与大小给用户确认，不带参数则下载并处理。 */
async function cmdSfx(filmDir, { list }) {
  if (!filmDir) fail('用法：wka sfx <片目录> [--list]');
  const { style } = loadFilm(filmDir, { requireShots: false });
  const { loadSfxLibrary, listSfx, fetchSfx } = await import('../audio/sfx.mjs');
  const lib = loadSfxLibrary(style);
  if (!lib) fail(`风格 ${style.id} 没有录音音效清单（style.json 的 sfx），音效请用 synth 合成`);
  if (list) {
    const rows = listSfx(lib);
    for (const r of rows) log(`${r.name.padEnd(8)} ${r.role.padEnd(10)} ${r.title.padEnd(36)} ${r.url.padEnd(62)} ${r.bytes === null ? '   ? KB' : `${String(Math.round(r.bytes / 1024)).padStart(4)} KB`}`);
    const total = rows.reduce((a, r) => a + (r.bytes || 0), 0);
    log(`${rows.length} 个文件，共 ${(total / 1024 / 1024).toFixed(1)} MB → ${lib.dir}\n${lib.license}`);
    return;
  }
  log(`下载并处理录音音效 → ${lib.dir}`);
  const failed = (await fetchSfx(lib, { log })).filter((r) => !r.ok);
  if (failed.length) fail(`${failed.length} 个音效没准备好：${failed.map((r) => r.name).join('、')}`);
  log('完成 ✓');
}

/** 字幕制作（第 11 道）：生成或检查 subtitles.srt；--preview 把字幕烧录到小样上审阅。 */
async function cmdSubtitles(filmDir, { force, preview, preflight, aspect }) {
  const ctx = loadFilm(filmDir, { aspect });
  const settings = subtitleSettings(ctx.film, ctx.variant);
  if (settings.mode === 'none') return log('本片 subtitles.mode 为 none，不出字幕');
  const file = path.join(ctx.filmDir, settings.file);
  const existed = fs.existsSync(file);
  if (preflight && !existed) fail(`还没有 ${settings.file}，请先生成字幕再预检`);
  let subs;
  if (fs.existsSync(file) && !force) {
    subs = (preview || preflight) ? null : readSubtitles(ctx, settings, {});
    log(`· 已存在 ${settings.file}（${subs?.length ?? "待预检"} 条，可能手改过断句），未覆盖。声音返修后要重新生成，请加 --force，会覆盖手改`);
  } else {
    const audio = ctx.film.audio || {};
    if (!audio.voices?.length || audio.voice_source === 'none') fail('本片没有人声，subtitles.mode 应为 none');
    subs = buildSubtitles(audio.voices, ctx.film.cues || {}, { maxChars: settings.maxChars, protectedTerms: settings.protectedTerms });
    reportSubtitleCheck(ctx, settings, subs);
    fs.writeFileSync(file, formatSrt(subs));
    log(`✓ 字幕 ${subs.length} 条 → ${settings.file}`);
  }
  if (settings.bilingual && !preflight && !(preview && existed)) {
    const enExists=fs.existsSync(path.join(ctx.filmDir,settings.enFile));
    if(!ctx.variant.isMain && (force || !enExists)) writeVariantEnglish(ctx,settings,subs);
    syncEnglishFile(ctx,settings,subs,{force});
  }
  if (!preview && !preflight) {
    registerReview(filmDir,'subtitles',[path.join(ctx.filmDir,settings.file),...(settings.bilingual?[path.join(ctx.filmDir,settings.enFile)]:[])],aspect);
    return;
  }
  const video = path.join(ctx.variant.cacheDir, 'video-proxy.mp4');
  const checked = await preflightSubtitles(ctx,{proxy:true,video,subs,log});
  registerSubtitleEvidence(ctx,checked,true);
  if (!preview) return;
  subs=checked.subs;
  const mix = path.join(ctx.filmDir, '.cache', 'mix.wav');
  const out = path.join(ensureDir(path.join(ctx.filmDir, 'review')), ctx.variant.review('字幕预览.mp4'));
  const { W, H } = outputSize(ctx.film, true);
  await burnSubtitles(video, subs, out, { W, H, style: ctx.style, workDir: path.join(ctx.variant.cacheDir, 'work'), proxy: true, fps: outputSize(ctx.film,true).fps, prepared: checked.layers, audio: fs.existsSync(mix) ? mix : null, log });
  checkOutputTiming(ctx, out, { proxy: true, log });
  registerReview(filmDir,'subtitle-preview',[out],aspect,true);
  log(`字幕预览：${out}`);
}

/** --aspect all：先主版、再各副版；有过期副版时一个都不出。 */
async function cmdFinalAll(filmDir, o) {
  if (o.aspect !== 'all') return cmdFinal(filmDir, o);
  const { film } = loadFilm(filmDir);
  const stale = staleVariants(readProgress(filmDir));
  if (stale.length) fail(`${stale.join('、')} 副版已过期：主版在第 13 道重新签批过，先重做第 14 道「改版」并签批，再出全部画幅`);
  for (const aspect of listAspects(film)) {
    log(`\n── ${aspect}${aspect === listAspects(film)[0] ? ' 主版' : ' 副版'} ──`);
    await cmdFinal(filmDir, { ...o, aspect });
  }
}

async function cmdFinal(filmDir, o) {
  let ctx = loadFilm(filmDir, { aspect: o.aspect });
  const conflicts=decisionConflicts(ctx,readDecisions(ctx.filmDir));if(conflicts.length)throw new Error(conflicts.join('；'));
  if (!ctx.variant.isMain) {
    if (variantStale(readProgress(filmDir), ctx.variant.aspect)) {
      fail(`${ctx.variant.aspect} 副版已过期：主版在第 13 道重新签批过，先重做第 14 道「改版」并签批，再出副版成片`);
    }
    const mainCheck = await checkMainUnchanged(filmDir, { aspect: o.aspect, log });
    if (mainCheck?.timingChanged) fail('主版时间轴已变化，请先明确重出主版并完成第 13 道终审，再导出副版');
  }
  const settings = subtitleSettings(ctx.film, ctx.variant);
  const formats = o.formats ? String(o.formats).split(',') : ctx.film.export?.formats || ['mp4'];
  const draftOnly=formats.every(f=>f==='jianying');
  let subs = settings.mode === 'none' ? null : [];
  // 先混音：人声会刷新 film.json 的声音同步点（cues），画面再按同步点渲染
  const { mix: audio, tracks, voices,loudness } = await (await import('../audio/soundtrack.mjs')).mixSoundtrack(filmDir, { log });
  ctx=loadFilm(filmDir,{aspect:o.aspect});
  const { video, job, segments } = await render(filmDir, {...o,segmentsOnly:draftOnly});
  if(draftOnly&&subs) {
    subs=readSubtitles(ctx,settings,{missing:`还没有 ${settings.file}，请先制作字幕`});
    if(settings.bilingual){
      const pairs=readEnglish(ctx,settings),errors=checkEnglish(pairs||[],{maxChars:settings.maxCharsEn});
      if(!pairs||pairs.length!==subs.length||pairs.some((p,i)=>!p.en?.trim()||p.zh!==subs[i].text)||errors.length) throw new Error('草稿双语字幕缺失或与中文字幕不一致');
      subs=subs.map((s,i)=>({...s,en:pairs[i].en}));
    }
  }
  const checked = subs&&!draftOnly ? await preflightSubtitles(ctx,{proxy:!!o.proxy,video,subs,log}) : null;
  if(checked)registerSubtitleEvidence(ctx,checked,!!o.proxy);
  if(checked) subs=checked.subs;
  // 画面类成片按字幕方式出烧录版 / 无字幕版，文件名标明有没有字幕；剪映草稿只导一份
  const visual = formats.filter((f) => f !== 'jianying');
  const drafts = formats.filter((f) => f === 'jianying');
  const names = subtitleOutputs(subs ? settings.mode : 'none', settings.bilingual);
  const outs = [];
  if (visual.length && names.burned !== null) {
    const out = path.join(ctx.variant.cacheDir, o.proxy ? 'video-subtitled-proxy.mp4' : 'video-subtitled.mp4');
    const burned = await runStage(ctx.filmDir,{stage:'subtitle-burn',aspect:ctx.variant.aspect,proxy:!!o.proxy,force:o.force,signature:digest({video:fileDigest(video),subs,style:ctx.style.subtitles,layers:checked?.report?.signature}),log,run:async()=>{
      const value=await burnSubtitles(video,subs,out,{W:job.W,H:job.H,style:ctx.style,workDir:job.workDir,proxy:o.proxy,prepared:checked?.layers,log});return {value,outputs:[value]};}});
    checkOutputTiming(ctx, burned, { proxy: o.proxy, log });
    outs.push(...(await encodeOutputs(filmDir, { video: burned, audio, proxy: o.proxy, formats: visual, suffix: names.burned, aspect: o.aspect, force:o.force,log })));
  }
  // 已有烧录版时，无字幕版只多出一个 mp4
  if (visual.length && names.clean !== null) {
    const cleanFormats = names.burned === null ? visual : ['mp4'];
    outs.push(...(await encodeOutputs(filmDir, { video, audio, proxy: o.proxy, formats: cleanFormats, suffix: names.clean, aspect: o.aspect,force:o.force, log })));
  }
  if (drafts.length) {
    const difference=draftAudioDifference(ctx,tracks,loudness??null);
    registerReview(filmDir,'draft-audio-difference',difference.files,o.aspect);
    log(`[${ctx.variant.aspect} 高清 · draft-export] 写入前说明：${difference.report.note}\n${difference.files[0]}`);
    // 时间线：给需要分镜 / 分轨信息的导出器（如剪映草稿）用
    const timeline = { title: ctx.variant.title, size: job.film.size, fps: job.film.fps, duration: job.timeline.duration, shots: segments, tracks, voices, subtitleStyle: subtitleStyle(ctx.style), ...(subs ? { subtitles: subs } : {}) };
    outs.push(...(await encodeOutputs(filmDir, { video, audio, timeline, proxy: o.proxy, formats: drafts, aspect: o.aspect,force:o.force, log })));
  }
  if (names.srt !== null && !o.proxy && !draftOnly) {
    const srt = path.join(ctx.filmDir, `${ctx.variant.exportName}${names.srt}.srt`);
    fs.copyFileSync(path.join(ctx.filmDir, settings.file), srt);
    registerReview(filmDir,'sidecar-srt',[srt],o.aspect);
    log(`  导出 srt → ${path.basename(srt)}`);
    outs.push(srt);
  }
  if (names.srtEn && !o.proxy && !draftOnly) {
    const srt = path.join(ctx.filmDir, `${ctx.variant.exportName}${names.srtEn}.srt`);
    fs.writeFileSync(srt, englishSrt(subs));
    registerReview(filmDir,'sidecar-en',[srt],o.aspect);
    log(`  导出英文 srt → ${path.basename(srt)}`);
    outs.push(srt);
  }
  log(`\n完成 ✓\n${outs.map((x) => `  ${x}`).join('\n')}`);
}

async function main() {
  switch (cmd) {
    case 'delivery': {
      if(!pos[0]) throw new Error('用法：wka delivery <片目录> --host codex|claude|generic [--json]');
      const report=writeDelivery(pos[0],{host:opt('host','codex'),aspect:aspectOpt()});
      log(opt('json')?JSON.stringify(report,null,2):[...report.links.map(l=>'- '+l),...report.errors].join('\n'));
      process.exitCode=report.ok?0:2;return;
    }
    case 'resume': {
      if(!pos[0]) throw new Error('用法：wka resume <片目录> [--json]');
      const status=recoveryStatus(path.resolve(pos[0]));
      log(opt('json')?JSON.stringify(status,null,2):[...status.stages.map(s=>`[${s.aspect} ${s.proxy?'小样':'高清'} · ${s.stage}] ${s.status}${s.error?'：'+s.error:''}`),status.next].join('\n'));return;
    }
    case 'setup':
      return cmdSetup();
    case 'check':
      process.exitCode = (await cmdCheck()) ? 1 : 0;
      return;
    case 'list':
      return cmdList(pos[0]);
    case 'init-project':
      log('项目初始化');
      initProject(pos[0] || '.', { log });
      return;
    case 'brief':
      return cmdBrief(pos[0], { dir: opt('dir', '.') });
    case 'new':
      return cmdNew(pos[0], pos[1], { name: opt('name'), category: opt('category', 'custom'), order: opt('order', 101), dest: opt('dest', USER_STYLES_DIR) });
    case 'init':
      return cmdInit(pos[0], { style: opt('style'), dir: opt('dir', '.'), aspect: opt('aspect', '16:9') });
    case 'signoff': {
      if (!pos[0] || !pos[1]) fail('用法：wka signoff <片目录> "<审片结论>" [--step N]');
      const step = opt('step') ? Number(opt('step')) : null;
      if (step && !PRODUCTION_STEPS[step]) fail(`--step 取 1–${LAST_STEP}`);
      let note = pos[1];
      // 第 5 道分镜签批前检查景别；确实要这样拍可以 --force，问题会附在签批记录里
      if (step === SHOT_SIZE_STEP) {
        const problems = checkShotSizes(loadFilm(pos[0], { requireShots: false }).film.shots);
        if (problems.length && !opt('force')) fail(`景别检查未通过，分镜先别签批：\n  ${problems.join('\n  ')}\n  改 film.json 的 shots[].size 和 storyboard.md 的景别栏；确实要这样拍，加 --force`);
        if (problems.length) note = `${note}（景别检查未通过：${problems.join('；')}）`;
      }
      const pendingFile=path.join(path.resolve(pos[0]),'.wka/pending-approval.json');
      const signature=digest({sources:treeEvidence(path.resolve(pos[0]),(rel,ent)=>ent.isDirectory()&&['.git','.cache','.wka','review','stills','generated','node_modules'].includes(ent.name)),implementation:implementationState(),decisions:readDecisions(pos[0]),shots:step===13||step===14?shotHashes(pos[0]):null});
      const pending=readJson(pendingFile),id=String(opt('approval-id')||(pending?.status!=='completed'&&pending?.note===note?pending.id:crypto.randomUUID()));
      if(pending?.id===id&&pending.signature!==signature) throw new Error('待存档批准之后输入已变化，请重新核实审阅，不能沿用旧批准');
      atomicJson(pendingFile,{id,step,note,signature,status:'prepared'});
      if (step === FINAL_REVIEW_STEP) {
        const ctx=loadFilm(pos[0]);requireTiming(ctx,{log});await requireSubtitlePreflight(ctx,{proxy:false});
      }
      if (step === 11) await requireSubtitlePreflight(loadFilm(pos[0]),{proxy:true});
      if (step === VARIANT_STEP) {
        const { film } = loadFilm(pos[0]);
        for (const aspect of Object.keys(film.variants || {})) {
          const ctx = loadFilm(pos[0], { aspect });
          const checked = await checkMainUnchanged(pos[0], { aspect, log });
          if (checked && !checked.ok) fail('主版不变检查未通过，不能签批副版；先完成主版复核');
          const proxy = fs.existsSync(path.join(ctx.variant.cacheDir, 'timing-proxy.json'));
          requireTiming(ctx, { proxy, log });
          await requireSubtitlePreflight(ctx,{proxy});
        }
      }
      const prior=readProgress(pos[0]).history.find(h=>h.approvalId===id);
      let main=null,variants=null;
      if(!prior&&step===FINAL_REVIEW_STEP){const snapshot=snapshotMain(pos[0],{log});if(snapshot.missing.length)throw new Error('缺少完整定稿快照，签批存档未提交');main=snapshot.hashes;}
      if(!prior&&step===VARIANT_STEP){const {film}=loadFilm(pos[0]);variants=Object.fromEntries(Object.keys(film.variants||{}).map(aspect=>[aspect,shotHashes(pos[0],{aspect})]));}
      commitSignoff(pos[0],{id,step,note,signature,main,variants});
      atomicJson(pendingFile,{id,step,note,signature,status:'completed',git:'pending'});
      const sha = commitSnapshot(pos[0], note, { log });
      atomicJson(pendingFile,{id,step,note,signature,status:'completed',git:sha?'committed':'not-confirmed',sha});
      if (step) log(`  进度：第 ${step} 道工序「${PRODUCTION_STEPS[step]}」${REVIEW_GATES[step] ? ' · 审片节点 ' + REVIEW_GATES[step] : ''}`);
      void sha;
      return;
    }
    case 'status': {
      const list = listProductions(pos[0] || '.');
      if (!list.length) return log('还没有片子。用 wka init <片名> --style <id> 开始。');
      for (const f of list) {
        log(`${f.name}  《${f.title}》 ${f.style}`);
        if (f.migrated) log(`  · 进度已按新流程（${LAST_STEP} 道工序）换算`);
        log(`  进度 ${f.step}/${LAST_STEP}${f.step ? ` 「${PRODUCTION_STEPS[f.step]}」` : ''}  →  下一步：${f.next ? `${f.next}. ${f.nextLabel}` : '已完成'}`);
        if (f.last) log(`  最近：${f.last.at.slice(0, 16).replace('T', ' ')}  ${f.last.note}`);
        for (const a of f.staleVariants) log(`  ! ${a} 副版已过期：主版在第 13 道重新签批过，要重做第 14 道「改版」`);
      }
      return;
    }
    case 'qc': {
      if (!pos[0]) fail('用法：wka qc <片目录> [--proxy] [--aspect 9:16]');
      const r = await runQc(pos[0], { proxy: !!opt('proxy'), aspect: aspectOpt(), log });
      process.exitCode = r.ok ? 0 : 2;
      return;
    }
    case 'still': {
      if (!pos[0]) fail('用法：wka still <片目录>');
      const at = opt('at')
        ? String(opt('at')).split(',').map((x) => {
            const [shot, t] = x.split(':');
            return { shot, t: parseFloat(t) };
          })
        : null;
      await checkMainUnchanged(pos[0], { aspect: aspectOpt(), log });
      const r = await stills(pos[0], { at, frames: Number(opt('frames', 1)), proxy: !!opt('proxy'), aspect: aspectOpt(), log });
      registerReview(pos[0],'stills',[...r.files,...(r.contactSheet?[r.contactSheet]:[])],aspectOpt(),!!opt('proxy'));
      if (r.contactSheet) log(`接触表：${r.contactSheet}`);
      return;
    }
    case 'animatic': {
      if (!pos[0]) fail('用法：wka animatic <片目录> [--proxy]');
      const r = await animatic(pos[0], { proxy: !!opt('proxy'), aspect: aspectOpt(), log });
      registerReview(pos[0],'animatic',[r.file,...(r.contactSheet?[r.contactSheet]:[])],aspectOpt(),!!opt('proxy'));
      if (r.contactSheet) log(`接触表：${r.contactSheet}`);
      log(`动态分镜：${r.file}`);
      return;
    }
    case 'render': {
      if (!pos[0]) fail('用法：wka render <片目录>');
      const proxy = !!opt('proxy');
      await checkMainUnchanged(pos[0], { aspect: aspectOpt(), log });
      const { video, job } = await render(pos[0], { proxy, only: opt('only') ? String(opt('only')).split(',') : null, force: !!opt('force'), aspect: aspectOpt(), log });
      if (!proxy) return;
      // 小样配上声轨，放进 review/ 交给用户审阅
      const mix = path.join(path.resolve(pos[0]), '.cache', 'mix.wav');
      const hasMix = fs.existsSync(mix);
      if (!hasMix) log('  ! 没有 .cache/mix.wav，小样不带声音（先运行 wka soundtrack）');
      const args = hasMix ? ['-i', video, '-i', mix, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', ...generatedMixPadding(mix,job.timeline.duration,job.fps), '-shortest'] : ['-i', video, '-c', 'copy'];
      const out = await writeReview(pos[0], job.variant.review('小样.mp4'), [...args, '-movflags', '+faststart']);
      checkOutputTiming(job, out, { proxy, log });
      registerReview(pos[0],'proxy',[out],aspectOpt(),true);
      log(`小样：${out}`);
      return;
    }
    case 'soundtrack': {
      if (!pos[0]) fail('用法：wka soundtrack <片目录>');
      loadFilm(pos[0], { requireShots: false });
      const { mix } = await (await import('../audio/soundtrack.mjs')).mixSoundtrack(pos[0], { log });
      // WAV 体积大，聊天里播放会卡：另存一份 AAC 放进 review/ 交给用户审听
      if (mix) {const out=await writeReview(pos[0], '声轨.m4a', ['-i', mix, '-c:a', 'aac', '-b:a', '192k']);registerReview(pos[0],'soundtrack',[out]);log(`声轨审听：${out}`);}
      return;
    }
    case 'sfx':
      return cmdSfx(pos[0], { list: !!opt('list') });
    case 'audition': {
      if (!pos[0]) fail('用法：wka audition <片目录> [--voices a,b,c] [--text "…"] [--rate -20%] [--pitch -2Hz]');
      const ctx = loadFilm(pos[0], { requireShots: false });
      const { auditionVoices, DEFAULT_AUDITION_VOICES } = await import('../audio/audition.mjs');
      const voices = typeof opt('voices') === 'string' ? opt('voices').split(',').map((v) => v.trim()).filter(Boolean) : DEFAULT_AUDITION_VOICES;
      const first = ctx.film.audio?.voices?.[0] || {};
      const str = (name) => (typeof opt(name) === 'string' ? opt(name) : undefined);
      // 没给参数时用第一条人声的文本和它已经调过的语速、音高
      const text = str('text') ?? first.text;
      const audition=auditionVoices({ text, voices, rate: str('rate') ?? first.rate, pitch: str('pitch') ?? first.pitch, outDir: path.join(ctx.filmDir, 'review'), log });
      registerReview(pos[0],'audition',audition.map(a=>a.file));
      return;
    }
    case 'subtitles':
      if (!pos[0]) fail('用法：wka subtitles <片目录> [--force] [--preview]');
      return cmdSubtitles(pos[0], { force: !!opt('force'), preview: !!opt('preview'), preflight: !!opt('preflight'), aspect: aspectOpt() });
    case 'final':
      if (!pos[0]) fail('用法：wka final <片目录> [--aspect 9:16|all]');
      return cmdFinalAll(pos[0], {
        proxy: !!opt('proxy'),
        only: opt('only') ? String(opt('only')).split(',') : null,
        force: !!opt('force'),
        formats: opt('formats'),
        aspect: aspectOpt(),
        log,
      });
    default: {
      // 帮助：文件开头的注释块（第 1 行是 shebang）
      const lines = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n');
      const help = lines.slice(1, lines.findIndex((l, i) => i > 0 && !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
      if (cmd === undefined || cmd === 'help' || cmd === '--help') return log(help);
      // 打错的命令要以非 0 退出，脚本和 CI 才能发现
      console.error(`✗ 未知命令 "${cmd}"\n\n${help}`);
      process.exitCode = 1;
    }
  }
}

function registerReview(filmDir,stage,outputs,aspect=null,proxy=false){
  const ctx=loadFilm(filmDir,{requireShots:false,aspect});
  rememberArtifacts(ctx.filmDir,{stage:'review:'+stage,aspect:ctx.variant.aspect,proxy,outputs,value:outputs,signature:digest(outputs.map(file=>fileDigest(file)))});
}
function registerSubtitleEvidence(ctx,checked,proxy){
  const settings=subtitleSettings(ctx.film,ctx.variant),base=path.join(ctx.filmDir,'review',`字幕预检${ctx.variant.suffix?'-'+ctx.variant.suffix:''}${proxy?'-proxy':''}`);
  const outputs=[base+'.md',base+'.json',path.join(ctx.filmDir,settings.file),...(settings.bilingual?[path.join(ctx.filmDir,settings.enFile)]:[]),...(checked.report.contactSheet?[checked.report.contactSheet]:[]),...checked.report.images.flatMap(i=>[i.file,...(i.guides?[i.guides]:[])])];
  registerReview(ctx.filmDir,'subtitle-preflight',outputs,ctx.variant.aspect,proxy);
}
async function execute(){
  const writes=['signoff','qc','still','animatic','render','soundtrack','subtitles','final'];
  const unlock=writes.includes(cmd)&&pos[0]?lockProduction(pos[0]):()=>{};
  if(writes.includes(cmd)&&pos[0])atomicJson(path.join(path.resolve(pos[0]),'.cache/active-command.json'),{argv:process.argv.slice(2)});
  try{await main();}finally{unlock();}
}
execute().catch((e) => fail(e.message));
