import fs from 'node:fs';
import path from 'node:path';
import { loadFilm } from '../core/film-context.mjs';
import { preflightBase } from '../core/subtitle-preflight.mjs';
import { parseSrt, checkSubtitles, subtitleSettings, syncEnglish, checkEnglish, splitEnglishForVariant } from '../core/subtitles.mjs';
import { rememberArtifacts } from '../core/operations.mjs';
import { recordFinalArtifact } from '../core/final-delivery.mjs';
import { digest, fileDigest } from '../core/evidence.mjs';
import { fail } from './context.mjs';

export function reviewArtifacts(log) {
  function readSubtitles(ctx, settings, { missing }) {
    const file = path.join(ctx.filmDir, settings.file);
    if (!fs.existsSync(file)) fail(missing);
    const subs = parseSrt(fs.readFileSync(file, 'utf8'));
    reportSubtitleCheck(ctx, settings, subs);
    return subs;
  }

  function readEnglish(ctx, settings) {
    const file = path.join(ctx.filmDir, settings.enFile);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      fail(`${settings.enFile} 不是合法的 JSON：${e.message}`);
    }
  }

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
  return { readSubtitles, readEnglish, syncEnglishFile, reportSubtitleCheck, writeVariantEnglish, registerReview, saveFinalSubtitle, registerSubtitleEvidence };
}
