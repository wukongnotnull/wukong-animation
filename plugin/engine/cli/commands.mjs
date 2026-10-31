import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir } from '../core/paths.mjs';
import { render, preview, encodeOutputs, loadFilm, outputSize, shotHashes } from '../core/job.mjs';
import { snapshotMain, checkMainUnchanged } from '../core/approval.mjs';
import { listAspects } from '../core/variants.mjs';
import { commitSnapshot } from '../core/project.mjs';
import { readProgress, variantStale, staleVariants, PRODUCTION_STEPS, REVIEW_GATES, LAST_STEP, commitSignoff } from '../core/state.mjs';
import { runQc } from '../core/qc.mjs';
import { preflightSubtitles, requireSubtitlePreflight, preflightBase } from '../core/subtitle-preflight.mjs';
import { requireTiming, checkTiming, checkOutputTiming } from '../core/timing.mjs';
import { checkShotSizes } from '../core/shot-sizes.mjs';
import { buildSubtitles, formatSrt, parseSrt, attachEnglish, checkSubtitles, subtitleSettings, subtitleOutputs, syncEnglish, checkEnglish, englishSrt, splitEnglishForVariant } from '../core/subtitles.mjs';
import { burnSubtitles, subtitleStyle } from '../core/subtitle-layer.mjs';
import { runStage, rememberArtifacts, implementationState } from '../core/operations.mjs';
import { writeDelivery, readDecisions, decisionConflicts } from '../core/delivery.mjs';
import { writeFinalDelivery, formatFinalDelivery, recordFinalEvidence, captureFinalGeneration, recordFinalArtifact, finalFontFiles, finalFontUnknown, prepareFinalApproval, commitFinalApproval } from '../core/final-delivery.mjs';
import { draftAudioDifference } from '../core/review-evidence.mjs';
import { digest, fileDigest, readJson, atomicJson, treeEvidence } from '../core/evidence.mjs';
import { fail } from './context.mjs';
import { environmentCommands } from './commands/environment.mjs';
import { projectCommands } from './commands/project.mjs';
import { mediaCommands } from './commands/media.mjs';
import { audioCommands } from './commands/audio.mjs';

const SHOT_SIZE_STEP = 5; // 第 5 道「分镜脚本」
const SUBTITLES_STEP = 10; // 第 10 道「字幕制作」：还没有小样，版式预检即可
const PROXY_STEP = 11; // 第 11 道「小样渲染与技术质检」：字幕要在小样画面上预检过
const FINAL_REVIEW_STEP = 13; // 第 13 道「终检与交付」：主版定稿
const VARIANT_STEP = 14; // 第 14 道「改版」：副版定稿

// 每次调用独立持有参数与日志；任务 3 按职责提取处理器。
export function commandsFor(context) {
  const { pos, opt, log, aspectOpt } = context;
  const groups = {
    'environment': environmentCommands(context),
    'project': projectCommands(context),
    'media': mediaCommands(context),
    'audio': audioCommands(context),
  };

// 插件外的风格（用户目录等）找不到插件里的 schema，编辑器改用仓库 main 分支上的这份

/** 制作简报（第 2 道）：建占位片目录和 brief.md 空白稿；第 3 道 wka init 在这个目录上补齐工程。 */

/** 新建风格：从引擎模板复制，默认放用户目录（升级插件不覆盖）；维护者用 --dest plugin/skills。 */

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

/** 字幕制作（第 10 道）：生成或检查 subtitles.srt；--preflight 预检，还没有小样时只做版式预检；--preview 把字幕烧录到小样上审阅（第 11 道）。 */
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
  const layout = !fs.existsSync(path.join(ctx.variant.cacheDir, 'timing-proxy.json')) || !checkTiming(ctx, { proxy: true }).ok;
  if (preview && layout) fail(`还没有当前的小样，不能烧录预览：先 wka render ${filmDir} --proxy${aspect ? ` --aspect ${aspect}` : ''}；第 10 道字幕用 --preflight 做版式预检`);
  const video = path.join(ctx.variant.cacheDir, 'video-proxy.mp4');
  const checked = await preflightSubtitles(ctx,{proxy:true,video,subs,layout,log});
  registerSubtitleEvidence(ctx,checked,true,layout);
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
      const pairs=readEnglish(ctx,settings);
      if(!pairs) throw new Error(`草稿双语字幕缺失：${settings.enFile}`);
      subs=attachEnglish(subs,pairs);
      for(const warning of checkEnglish(pairs,{maxChars:settings.maxCharsEn})) log('  ! '+warning);
    }
  }
  const checked = subs ? await preflightSubtitles(ctx,{proxy:!!o.proxy,video,subs,layout:draftOnly,log}) : null;
  if(checked)registerSubtitleEvidence(ctx,checked,!!o.proxy,draftOnly);
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
    outs.push(...(await encodeOutputs(filmDir, { video: burned, audio, proxy: o.proxy, formats: visual, suffix: names.burned, aspect: o.aspect, force:o.force,fontFiles:finalFontFiles(job.fonts,checked?.report),unknownReasons:finalFontUnknown(job.fonts,checked?.report),log })));
  }
  // 已有烧录版时，无字幕版只多出一个 mp4
  if (visual.length && names.clean !== null) {
    const cleanFormats = names.burned === null ? visual : ['mp4'];
    outs.push(...(await encodeOutputs(filmDir, { video, audio, proxy: o.proxy, formats: cleanFormats, suffix: names.clean, aspect: o.aspect,force:o.force,fontFiles:finalFontFiles(job.fonts),unknownReasons:finalFontUnknown(job.fonts), log })));
  }
  if (drafts.length) {
    const difference=draftAudioDifference(ctx,tracks,loudness??null);
    registerReview(filmDir,'draft-audio-difference',difference.files,o.aspect);
    log(`[${ctx.variant.aspect} 高清 · draft-export] 写入前说明：${difference.report.note}\n${difference.files[0]}`);
    // 时间线：给需要分镜 / 分轨信息的导出器（如剪映草稿）用
    const timeline = { title: ctx.variant.title, size: job.film.size, fps: job.film.fps, duration: job.timeline.duration, shots: segments, tracks, voices, subtitleStyle: subtitleStyle(ctx.style), ...(subs ? { subtitles: subs, subtitleMeasurements: checked.report.measurements } : {}) };
    outs.push(...(await encodeOutputs(filmDir, { video, audio, timeline, proxy: o.proxy, formats: drafts, aspect: o.aspect,force:o.force,fontFiles:finalFontFiles(job.fonts,checked?.report),unknownReasons:finalFontUnknown(job.fonts,checked?.report), log })));
  }
  if (names.srt !== null && !o.proxy && !draftOnly) {
    const srt = path.join(ctx.filmDir, `${ctx.variant.exportName}${names.srt}.srt`);
    const generation=captureFinalGeneration(ctx.filmDir,{slot:`${ctx.variant.aspect}/subtitle/zh`});
    fs.copyFileSync(path.join(ctx.filmDir, settings.file), srt);
    registerReview(filmDir,'sidecar-srt',[srt],o.aspect);
    saveFinalSubtitle(ctx,generation,srt,'review:sidecar-srt');
    log(`  导出 srt → ${path.basename(srt)}`);
    outs.push(srt);
  }
  if (names.srtEn && !o.proxy && !draftOnly) {
    const srt = path.join(ctx.filmDir, `${ctx.variant.exportName}${names.srtEn}.srt`);
    const generation=captureFinalGeneration(ctx.filmDir,{slot:`${ctx.variant.aspect}/subtitle/en`});
    fs.writeFileSync(srt, englishSrt(subs));
    registerReview(filmDir,'sidecar-en',[srt],o.aspect);
    saveFinalSubtitle(ctx,generation,srt,'review:sidecar-en');
    log(`  导出英文 srt → ${path.basename(srt)}`);
    outs.push(srt);
  }
  log(`\n完成 ✓\n${outs.map((x) => `  ${x}`).join('\n')}`);
}

function registerReview(filmDir,stage,outputs,aspect=null,proxy=false){
  const ctx=loadFilm(filmDir,{requireShots:false,aspect});
  rememberArtifacts(ctx.filmDir,{stage:'review:'+stage,aspect:ctx.variant.aspect,proxy,outputs,value:outputs,signature:digest(outputs.map(file=>fileDigest(file)))});
}
function saveFinalSubtitle(ctx,generation,file,stage){
  try{recordFinalArtifact(ctx.filmDir,{generation,path:file,stage,technical:{status:'passed',checks:['字幕完整性及实际写入'],errors:[]}});}
  catch(e){log(`  ! 字幕已生成，交付证据未存档，待核实：${e.message}`);}
}
function registerSubtitleEvidence(ctx,checked,proxy,layout=false){
  const settings=subtitleSettings(ctx.film,ctx.variant),base=preflightBase(ctx,{proxy,layout});
  const outputs=[base+'.md',base+'.json',path.join(ctx.filmDir,settings.file),...(settings.bilingual?[path.join(ctx.filmDir,settings.enFile)]:[]),...(checked.report.contactSheet?[checked.report.contactSheet]:[]),...checked.report.images.flatMap(i=>[i.file,...(i.guides?[i.guides]:[])])];
  registerReview(ctx.filmDir,'subtitle-preflight',outputs,ctx.variant.aspect,proxy);
}

  return {
    'delivery': { preflight: 'film', lock: 'final-record', active: false, run: async () => {
      if(!pos[0]) throw new Error('用法：wka delivery <片目录> --host codex|claude|generic [--json]');
      if(opt('record')&&!opt('final'))throw new Error('--record 需要 --final');
      if(opt('record'))recordFinalEvidence(pos[0]);
      const report=(opt('final')?writeFinalDelivery:writeDelivery)(pos[0],{host:opt('host','codex'),aspect:aspectOpt()});
      log(opt('json')?JSON.stringify(report,null,2):opt('final')?formatFinalDelivery(report):[...report.links.map(l=>'- '+l),...report.errors].join('\n'));
      return report.ok ? 0 : 2;
    } },
    'resume': { preflight: 'none', lock: 'none', active: false, run: groups['project']['resume'] },
    'setup': { preflight: 'none', lock: 'none', active: false, run: groups['environment']['setup'] },
    'check': { preflight: 'none', lock: 'none', active: false, run: groups['environment']['check'] },
    'list': { preflight: 'none', lock: 'none', active: false, run: groups['environment']['list'] },
    'init-project': { preflight: 'project', lock: 'none', active: false, run: groups['project']['init-project'] },
    'brief': { preflight: 'new-film', lock: 'none', active: false, run: groups['project']['brief'] },
    'new': { preflight: 'none', lock: 'none', active: false, run: groups['project']['new'] },
    'init': { preflight: 'new-film', lock: 'none', active: false, run: groups['project']['init'] },
    'signoff': { preflight: 'film', lock: 'film', active: true, run: async () => {
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
      const pending=readJson(pendingFile),id=String(opt('approval-id')||(pending?.status!=='completed'&&pending?.note===note?pending.id:crypto.randomUUID()));
      const revision=opt('delivery-revision');
      if(revision===true)throw new Error('--delivery-revision 需要完整摘要');
      const deliveryApproval=revision?prepareFinalApproval(pos[0],{id,step,revision,source:'用户明确签批（signoff）',note,openEvidence:opt('open-status')?{status:opt('open-status'),source:note}:null}):null;
      const signature=digest({sources:treeEvidence(path.resolve(pos[0]),(rel,ent)=>ent.isDirectory()&&['.git','.cache','.wka','review','stills','generated','node_modules'].includes(ent.name)),implementation:implementationState(),decisions:readDecisions(pos[0]),shots:step===13||step===14?shotHashes(pos[0]):null,...(revision?{deliveryRevision:revision}:{})});
      if(pending?.id===id&&pending.signature!==signature) throw new Error('待存档批准之后输入已变化，请重新核实审阅，不能沿用旧批准');
      const deliveryProof=deliveryApproval?{deliveryApproval:deliveryApproval.existing&&pending?.deliveryApproval?.review?pending.deliveryApproval:deliveryApproval}:{};
      atomicJson(pendingFile,{id,step,note,signature,status:'prepared',...deliveryProof});
      if (step === FINAL_REVIEW_STEP) {
        const ctx=loadFilm(pos[0]);requireTiming(ctx,{fresh:true,log});await requireSubtitlePreflight(ctx,{proxy:false});
      }
      if (step === SUBTITLES_STEP) {
        const ctx=loadFilm(pos[0]);
        try { await requireSubtitlePreflight(ctx,{proxy:true}); } catch { await requireSubtitlePreflight(ctx,{proxy:true,layout:true}); }
      }
      if (step === PROXY_STEP) {
        const ctx=loadFilm(pos[0]);
        requireTiming(ctx,{proxy:true,fresh:true,log});
        await requireSubtitlePreflight(ctx,{proxy:true});
      }
      if (step === VARIANT_STEP) {
        const { film } = loadFilm(pos[0]);
        for (const aspect of Object.keys(film.variants || {})) {
          const ctx = loadFilm(pos[0], { aspect });
          const checked = await checkMainUnchanged(pos[0], { aspect, log });
          if (checked && !checked.ok) fail('主版不变检查未通过，不能签批副版；先完成主版复核');
          const proxy = fs.existsSync(path.join(ctx.variant.cacheDir, 'timing-proxy.json'));
          requireTiming(ctx, { proxy, fresh: true, log });
          await requireSubtitlePreflight(ctx,{proxy});
        }
      }
      const prior=readProgress(pos[0]).history.find(h=>h.approvalId===id);
      let main=null,variants=null;
      if(!prior&&step===FINAL_REVIEW_STEP){const snapshot=snapshotMain(pos[0],{log});if(snapshot.missing.length)throw new Error('缺少完整定稿快照，签批存档未提交');main=snapshot.hashes;}
      if(!prior&&step===VARIANT_STEP){const {film}=loadFilm(pos[0]);variants=Object.fromEntries(Object.keys(film.variants||{}).map(aspect=>[aspect,shotHashes(pos[0],{aspect})]));}
      commitSignoff(pos[0],{id,step,note,signature,main,variants});
      if(deliveryApproval)commitFinalApproval(pos[0],deliveryApproval);
      atomicJson(pendingFile,{id,step,note,signature,status:'completed',git:'pending',...deliveryProof});
      const sha = commitSnapshot(pos[0], note, { log });
      atomicJson(pendingFile,{id,step,note,signature,status:'completed',git:sha?'committed':'not-confirmed',sha,...deliveryProof});
      if (step) log(`  进度：第 ${step} 道工序「${PRODUCTION_STEPS[step]}」${REVIEW_GATES[step] ? ' · 审片节点 ' + REVIEW_GATES[step] : ''}`);
      void sha;
      return;
    } },
    'status': { preflight: 'none', lock: 'none', active: false, run: groups['project']['status'] },
    'qc': { preflight: 'film', lock: 'film', active: true, run: async () => {
      if (!pos[0]) fail('用法：wka qc <片目录> [--proxy] [--aspect 9:16]');
      const r = await runQc(pos[0], { proxy: !!opt('proxy'), aspect: aspectOpt(), log });
      return r.ok ? 0 : 2;
    } },
    'still': { preflight: 'film', lock: 'film', active: true, run: groups['media']['still'] },
    'animatic': { preflight: 'film', lock: 'film', active: true, run: groups['media']['animatic'] },
    'preview': { preflight: 'film', lock: 'film', active: true, run: groups['media']['preview'] },
    'clean': { preflight: 'film', lock: 'film', active: true, run: groups['media']['clean'] },
    'render': { preflight: 'film', lock: 'film', active: true, run: groups['media']['render'] },
    'soundtrack': { preflight: 'film', lock: 'film', active: true, run: groups['audio']['soundtrack'] },
    'sfx': { preflight: 'film-unless-list', lock: 'none', active: false, run: groups['audio']['sfx'] },
    'audition': { preflight: 'film', lock: 'none', active: false, run: groups['audio']['audition'] },
    'subtitles': { preflight: 'film', lock: 'film', active: true, run: async () => {
      if (!pos[0]) fail('用法：wka subtitles <片目录> [--force] [--preview]');
      return cmdSubtitles(pos[0], { force: !!opt('force'), preview: !!opt('preview'), preflight: !!opt('preflight'), aspect: aspectOpt() });
    } },
    'final': { preflight: 'film', lock: 'film', active: true, run: async () => {
      if (!pos[0]) fail('用法：wka final <片目录> [--aspect 9:16|all]');
      return cmdFinalAll(pos[0], {
        proxy: !!opt('proxy'),
        only: opt('only') ? String(opt('only')).split(',') : null,
        force: !!opt('force'),
        formats: opt('formats'),
        aspect: aspectOpt(),
        log,
      });
    } }
  };
}
