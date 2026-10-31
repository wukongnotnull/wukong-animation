import fs from 'node:fs';
import path from 'node:path';
import { render, preview, stills, animatic, writeReview } from '../../core/job.mjs';
import { loadFilm } from '../../core/film-context.mjs';
import { cleanRenderCache } from '../../core/cache.mjs';
import { checkMainUnchanged } from '../../core/approval.mjs';
import { generatedMixPadding } from '../../core/ffmpeg.mjs';
import { checkOutputTiming } from '../../core/timing.mjs';
import { recordFinalArtifact, finalFontFiles, finalFontUnknown, captureFinalProxy, withGenerationFonts } from '../../core/final-delivery.mjs';
import { fail } from '../context.mjs';
import { reviewArtifacts } from '../review-artifacts.mjs';

export function mediaCommands({ pos, opt, log, aspectOpt }) {
  const { registerReview } = reviewArtifacts(log);

  return {
    'still': async () => {
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
    },
    'animatic': async () => {
      if (!pos[0]) fail('用法：wka animatic <片目录> [--proxy]');
      const r = await animatic(pos[0], { proxy: !!opt('proxy'), aspect: aspectOpt(), log });
      registerReview(pos[0],'animatic',[r.file,...(r.contactSheet?[r.contactSheet]:[])],aspectOpt(),!!opt('proxy'));
      if (r.contactSheet) log(`接触表：${r.contactSheet}`);
      log(`动态分镜：${r.file}`);
      return;
    },
    'preview': async () => {
      if (!pos[0]) fail('用法：wka preview <片目录> [--only s01,s03] [--native]');
      return preview(pos[0], { only: opt('only') ? String(opt('only')).split(',') : null, proxy: !opt('native'), aspect: aspectOpt(), force: !!opt('force'), log });
    },
    'clean': async () => {
      if (!pos[0] || !opt('render-cache')) fail('用法：wka clean <片目录> --render-cache [--aspect 9:16]');
      const ctx = loadFilm(pos[0], { requireShots: false, aspect: aspectOpt() });
      const removed = cleanRenderCache(ctx.variant.cacheDir);
      log(`已清理 ${removed.length} 项可再生渲染缓存；声音、素材、审阅文件、成片和签批快照保留`);
      return;
    },
    'render': async () => {
      if (!pos[0]) fail('用法：wka render <片目录>');
      const proxy = !!opt('proxy');
      await checkMainUnchanged(pos[0], { aspect: aspectOpt(), log });
      let sourceGeneration=null;
      if(proxy)try{sourceGeneration=captureFinalProxy(pos[0],{aspect:aspectOpt()});}catch(e){log(`  ! 小样来源未取证，保留渲染任务：${e.message}`);}
      const { video, job } = await render(pos[0], { proxy, only: opt('only') ? String(opt('only')).split(',') : null, force: !!opt('force'), aspect: aspectOpt(), log });
      if (!proxy) return;
      // 小样配上声轨，放进 review/ 交给用户审阅
      const mix = path.join(path.resolve(pos[0]), '.cache', 'mix.wav');
      const hasMix = fs.existsSync(mix);
      if (!hasMix) log('  ! 没有 .cache/mix.wav，小样不带声音（先运行 wka soundtrack）');
      const args = hasMix ? ['-i', video, '-i', mix, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', ...generatedMixPadding(mix,job.timeline.duration,job.fps), '-shortest'] : ['-i', video, '-c', 'copy'];
      const out = await writeReview(pos[0], job.variant.review('小样.mp4'), [...args, '-movflags', '+faststart']);
      checkOutputTiming(job, out, { proxy, log });
      if(sourceGeneration)try{recordFinalArtifact(pos[0],{generation:withGenerationFonts(pos[0],sourceGeneration,finalFontFiles(job.fonts),finalFontUnknown(job.fonts)),path:out,stage:'review:proxy',technical:{status:'passed',checks:['小样时间轴'],errors:[]}});}catch(e){log(`  ! 小样来源证据未存档：${e.message}`);}
      registerReview(pos[0],'proxy',[out],aspectOpt(),true);
      log(`小样：${out}`);
      return;
    }
  };
}
