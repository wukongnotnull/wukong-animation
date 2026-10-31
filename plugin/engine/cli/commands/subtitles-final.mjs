import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../../core/paths.mjs';
import { render, encodeOutputs, outputSize } from '../../core/job.mjs';
import { loadFilm } from '../../core/film-context.mjs';
import { checkMainUnchanged } from '../../core/approval.mjs';
import { listAspects } from '../../core/variants.mjs';
import { readProgress, variantStale, staleVariants } from '../../core/state.mjs';
import { preflightSubtitles } from '../../core/subtitle-preflight.mjs';
import { checkTiming, checkOutputTiming } from '../../core/timing.mjs';
import { buildSubtitles, formatSrt, attachEnglish, subtitleSettings, subtitleOutputs, checkEnglish, englishSrt } from '../../core/subtitles.mjs';
import { burnSubtitles, subtitleStyle } from '../../core/subtitle-layer.mjs';
import { runStage } from '../../core/operations.mjs';
import { readDecisions, decisionConflicts } from '../../core/delivery.mjs';
import { captureFinalGeneration, finalFontFiles, finalFontUnknown } from '../../core/final-delivery.mjs';
import { draftAudioDifference } from '../../core/review-evidence.mjs';
import { digest, fileDigest } from '../../core/evidence.mjs';
import { fail } from '../context.mjs';
import { reviewArtifacts } from '../review-artifacts.mjs';

export function subtitlesFinalCommands({ pos, opt, log, aspectOpt }) {
  const { readSubtitles, readEnglish, syncEnglishFile, writeVariantEnglish, reportSubtitleCheck, registerReview, registerSubtitleEvidence, saveFinalSubtitle } = reviewArtifacts(log);
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
    const { mix: audio, tracks, voices,loudness } = await (await import('../../audio/soundtrack.mjs')).mixSoundtrack(filmDir, { log });
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
  return {
    'subtitles': async () => {
      if (!pos[0]) fail('用法：wka subtitles <片目录> [--force] [--preview]');
      return cmdSubtitles(pos[0], { force: !!opt('force'), preview: !!opt('preview'), preflight: !!opt('preflight'), aspect: aspectOpt() });
    },
    'final': async () => {
      if (!pos[0]) fail('用法：wka final <片目录> [--aspect 9:16|all]');
      return cmdFinalAll(pos[0], {
        proxy: !!opt('proxy'),
        only: opt('only') ? String(opt('only')).split(',') : null,
        force: !!opt('force'),
        formats: opt('formats'),
        aspect: aspectOpt(),
        log,
      });
    }
  };
}
