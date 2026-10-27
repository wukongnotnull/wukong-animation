#!/usr/bin/env node
// wka —— wukong-animation 引擎命令行。
//   wka setup                         安装依赖到 ~/.wukong-animation/deps/<版本>/
//   wka check                         检查环境与所有插槽
//   wka list [styles|pipelines|kits|exporters]
//   wka init-project [目录]           git 初始化工程（第 1 道工序）
//   wka init <片名> --style <id> [--dir 项目目录] [--aspect 16:9|9:16]
//   wka status [项目目录]             各片制作进度（恢复在制项目）
//   wka signoff <片目录> "<审片结论>" [--step N]   审片节点签批：记录进度并做定版快照
//   wka qc <片目录> [--proxy]       量化技术质检（QC）
//   wka still <片目录> [--frames N] [--at s02:1.5,s03:2] [--proxy]   静帧 + 接触表
//   wka animatic <片目录> [--proxy]   动态分镜：关键帧按镜头时长排成粗片并配上声轨
//   wka render <片目录> [--proxy] [--only s01,s03] [--force]   渲染（--proxy 为小样）
//   wka soundtrack <片目录>           声轨制作：配乐 + 人声，写入声音同步点（不要求镜头文件已写好）
//   wka audition <片目录> [--voices a,b,c] [--text "…"] [--rate -20%] [--pitch -2Hz]   音色试听：同一句用几个音色各合成一遍
//   wka subtitles <片目录> [--force] [--preview]   字幕制作：从人声生成 subtitles.srt；--preview 烧录到小样上审阅
//   wka final <片目录> [--proxy] [--only ...] [--formats mp4,gif]   终版渲染与终混
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRegistry, getStyles, loadModule } from '../core/registry.mjs';
import { ENGINE_VERSION, ENGINE_ROOT, PLUGIN_ROOT, DEPS_DIR, HOME, ensureDir } from '../core/paths.mjs';
import { render, stills, animatic, encodeOutputs, loadFilm, outputSize, writeReview } from '../core/job.mjs';
import { initProject, commitSnapshot, hasGit } from '../core/project.mjs';
import { hasFfmpeg } from '../core/ffmpeg.mjs';
import { detectTtsEngine } from '../audio/tts.mjs';
import { resolveStyle } from '../core/resolver.mjs';
import { recordProgress, listProductions, PRODUCTION_STEPS, REVIEW_GATES, LAST_STEP } from '../core/state.mjs';
import { runQc } from '../core/qc.mjs';
import { checkShotSizes } from '../core/shot-sizes.mjs';
import { buildSubtitles, formatSrt, parseSrt, checkSubtitles, subtitleSettings, subtitleOutputs } from '../core/subtitles.mjs';
import { burnSubtitles, subtitleStyle } from '../core/subtitle-layer.mjs';

const SHOT_SIZE_STEP = 5; // 第 5 道「分镜脚本」
const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(arr[i - 1] || '').match(/^--(style|dir|aspect|frames|at|only|formats|step|voices|text|rate|pitch)$/));
const opt = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const log = (...a) => console.log(...a);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

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
  const tpl = path.join(PLUGIN_ROOT, 'skills', 'director', 'templates', 'film');
  fs.cpSync(tpl, filmDir, { recursive: true });
  const size = aspect === '9:16' ? [1080, 1920] : aspect === '1:1' ? [1080, 1080] : [1920, 1080];
  const film = JSON.parse(fs.readFileSync(path.join(filmDir, 'film.json'), 'utf8'));
  Object.assign(film, { title: name, style: st.id, size, fps: st.fps });
  fs.writeFileSync(path.join(filmDir, 'film.json'), JSON.stringify(film, null, 2) + '\n');
  log(`✓ 已创建 ${path.relative(process.cwd(), filmDir) || '.'}（风格 ${st.name} · ${size.join('×')} @${st.fps}fps）`);
  log(`  风格文档：${path.join(st.dir, 'STYLE.md')}`);
  log(`  技术文档：${path.join(st.dir, 'TECH.md')}`);
}

/** 读字幕文件并检查；有错误就中断，警告打印后继续。 */
function readSubtitles(ctx, settings, { missing }) {
  const file = path.join(ctx.filmDir, settings.file);
  if (!fs.existsSync(file)) fail(missing);
  const subs = parseSrt(fs.readFileSync(file, 'utf8'));
  reportSubtitleCheck(ctx, settings, subs);
  return subs;
}

function reportSubtitleCheck(ctx, settings, subs) {
  const { errors, warnings } = checkSubtitles(subs, { duration: ctx.totalDuration, maxChars: settings.maxChars });
  for (const w of warnings) log(`  ! ${w}`);
  if (errors.length) fail(`${settings.file} 有错误：\n  ${errors.join('\n  ')}`);
}

/** 字幕制作（第 11 道）：生成或检查 subtitles.srt；--preview 把字幕烧录到小样上审阅。 */
async function cmdSubtitles(filmDir, { force, preview }) {
  const ctx = loadFilm(filmDir);
  const settings = subtitleSettings(ctx.film);
  if (settings.mode === 'none') return log('本片 subtitles.mode 为 none，不出字幕');
  const file = path.join(ctx.filmDir, settings.file);
  let subs;
  if (fs.existsSync(file) && !force) {
    subs = readSubtitles(ctx, settings, {});
    log(`· 已存在 ${settings.file}（${subs.length} 条，可能手改过断句），未覆盖。声音返修后要重新生成，请加 --force，会覆盖手改`);
  } else {
    const audio = ctx.film.audio || {};
    if (!audio.voices?.length || audio.voice_source === 'none') fail('本片没有人声，subtitles.mode 应为 none');
    subs = buildSubtitles(audio.voices, ctx.film.cues || {}, { maxChars: settings.maxChars });
    reportSubtitleCheck(ctx, settings, subs);
    fs.writeFileSync(file, formatSrt(subs));
    log(`✓ 字幕 ${subs.length} 条 → ${settings.file}`);
  }
  if (!preview) return;
  const video = path.join(ctx.filmDir, '.cache', 'video-proxy.mp4');
  if (!fs.existsSync(video)) fail('还没有小样：先运行 wka render --proxy');
  const mix = path.join(ctx.filmDir, '.cache', 'mix.wav');
  const out = path.join(ensureDir(path.join(ctx.filmDir, 'review')), '字幕预览.mp4');
  const { W, H } = outputSize(ctx.film, true);
  await burnSubtitles(video, subs, out, { W, H, style: ctx.style, workDir: path.join(ctx.filmDir, '.cache', 'work'), proxy: true, audio: fs.existsSync(mix) ? mix : null, log });
  log(`字幕预览：${out}`);
}

async function cmdFinal(filmDir, o) {
  const ctx = loadFilm(filmDir);
  const settings = subtitleSettings(ctx.film);
  const subs = settings.mode === 'none' ? null : readSubtitles(ctx, settings, { missing: `还没有 ${settings.file}：先运行 wka subtitles` });
  // 先混音：人声会刷新 film.json 的声音同步点（cues），画面再按同步点渲染
  const { mix: audio, tracks, voices } = await (await import('../audio/soundtrack.mjs')).mixSoundtrack(filmDir, { log });
  const { video, job, segments } = await render(filmDir, o);
  const formats = o.formats ? String(o.formats).split(',') : ctx.film.export?.formats || ['mp4'];
  // 画面类成片按字幕方式出烧录版 / 无字幕版，文件名标明有没有字幕；剪映草稿只导一份
  const visual = formats.filter((f) => f !== 'jianying');
  const drafts = formats.filter((f) => f === 'jianying');
  const names = subtitleOutputs(subs ? settings.mode : 'none');
  const outs = [];
  if (visual.length && names.burned !== null) {
    const out = path.join(ctx.filmDir, '.cache', o.proxy ? 'video-subtitled-proxy.mp4' : 'video-subtitled.mp4');
    const burned = await burnSubtitles(video, subs, out, { W: job.W, H: job.H, style: ctx.style, workDir: job.workDir, proxy: o.proxy, log });
    outs.push(...(await encodeOutputs(filmDir, { video: burned, audio, proxy: o.proxy, formats: visual, suffix: names.burned, log })));
  }
  // 已有烧录版时，无字幕版只多出一个 mp4
  if (visual.length && names.clean !== null) {
    const cleanFormats = names.burned === null ? visual : ['mp4'];
    outs.push(...(await encodeOutputs(filmDir, { video, audio, proxy: o.proxy, formats: cleanFormats, suffix: names.clean, log })));
  }
  if (drafts.length) {
    // 时间线：给需要分镜 / 分轨信息的导出器（如剪映草稿）用
    const timeline = { title: job.film.title, size: job.film.size, fps: job.film.fps, duration: job.totalDuration, shots: segments, tracks, voices, subtitleStyle: subtitleStyle(ctx.style), ...(subs ? { subtitles: subs } : {}) };
    outs.push(...(await encodeOutputs(filmDir, { video, audio, timeline, proxy: o.proxy, formats: drafts, log })));
  }
  if (names.srt !== null && !o.proxy) {
    const srt = path.join(ctx.filmDir, `${ctx.film.export?.name || 'out'}${names.srt}.srt`);
    fs.copyFileSync(path.join(ctx.filmDir, settings.file), srt);
    log(`  导出 srt → ${path.basename(srt)}`);
    outs.push(srt);
  }
  log(`\n完成 ✓\n${outs.map((x) => `  ${x}`).join('\n')}`);
}

async function main() {
  switch (cmd) {
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
      recordProgress(pos[0], { step, note });
      const sha = commitSnapshot(pos[0], note, { log });
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
      }
      return;
    }
    case 'qc': {
      if (!pos[0]) fail('用法：wka qc <片目录> [--proxy]');
      const r = await runQc(pos[0], { proxy: !!opt('proxy'), log });
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
      const r = await stills(pos[0], { at, frames: Number(opt('frames', 1)), proxy: !!opt('proxy'), log });
      if (r.contactSheet) log(`接触表：${r.contactSheet}`);
      return;
    }
    case 'animatic': {
      if (!pos[0]) fail('用法：wka animatic <片目录> [--proxy]');
      const r = await animatic(pos[0], { proxy: !!opt('proxy'), log });
      if (r.contactSheet) log(`接触表：${r.contactSheet}`);
      log(`动态分镜：${r.file}`);
      return;
    }
    case 'render': {
      if (!pos[0]) fail('用法：wka render <片目录>');
      const proxy = !!opt('proxy');
      const { video } = await render(pos[0], { proxy, only: opt('only') ? String(opt('only')).split(',') : null, force: !!opt('force'), log });
      if (!proxy) return;
      // 小样配上声轨，放进 review/ 交给用户审阅
      const mix = path.join(path.resolve(pos[0]), '.cache', 'mix.wav');
      const hasMix = fs.existsSync(mix);
      if (!hasMix) log('  ! 没有 .cache/mix.wav，小样不带声音（先运行 wka soundtrack）');
      const args = hasMix ? ['-i', video, '-i', mix, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-i', video, '-c', 'copy'];
      log(`小样：${await writeReview(pos[0], '小样.mp4', [...args, '-movflags', '+faststart'])}`);
      return;
    }
    case 'soundtrack': {
      if (!pos[0]) fail('用法：wka soundtrack <片目录>');
      loadFilm(pos[0], { requireShots: false });
      const { mix } = await (await import('../audio/soundtrack.mjs')).mixSoundtrack(pos[0], { log });
      // WAV 体积大，聊天里播放会卡：另存一份 AAC 放进 review/ 交给用户审听
      if (mix) log(`声轨审听：${await writeReview(pos[0], '声轨.m4a', ['-i', mix, '-c:a', 'aac', '-b:a', '192k'])}`);
      return;
    }
    case 'audition': {
      if (!pos[0]) fail('用法：wka audition <片目录> [--voices a,b,c] [--text "…"] [--rate -20%] [--pitch -2Hz]');
      const ctx = loadFilm(pos[0], { requireShots: false });
      const { auditionVoices, DEFAULT_AUDITION_VOICES } = await import('../audio/audition.mjs');
      const voices = typeof opt('voices') === 'string' ? opt('voices').split(',').map((v) => v.trim()).filter(Boolean) : DEFAULT_AUDITION_VOICES;
      const first = ctx.film.audio?.voices?.[0] || {};
      const str = (name) => (typeof opt(name) === 'string' ? opt(name) : undefined);
      // 没给参数时用第一条人声的文本和它已经调过的语速、音高
      const text = str('text') ?? first.text;
      auditionVoices({ text, voices, rate: str('rate') ?? first.rate, pitch: str('pitch') ?? first.pitch, outDir: path.join(ctx.filmDir, 'review'), log });
      return;
    }
    case 'subtitles':
      if (!pos[0]) fail('用法：wka subtitles <片目录> [--force] [--preview]');
      return cmdSubtitles(pos[0], { force: !!opt('force'), preview: !!opt('preview') });
    case 'final':
      if (!pos[0]) fail('用法：wka final <片目录>');
      return cmdFinal(pos[0], {
        proxy: !!opt('proxy'),
        only: opt('only') ? String(opt('only')).split(',') : null,
        force: !!opt('force'),
        formats: opt('formats'),
        log,
      });
    default:
      log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  }
}

main().catch((e) => fail(e.message));
