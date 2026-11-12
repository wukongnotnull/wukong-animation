import fs from 'node:fs';
import path from 'node:path';
import { render, preview, stills, animatic, writeReview } from '../../core/job.mjs';
import { loadFilm } from '../../core/film-context.mjs';
import { cleanRenderCache } from '../../core/cache.mjs';
import { checkMainUnchanged } from '../../core/approval.mjs';
import { generatedMixPadding } from '../../core/ffmpeg.mjs';
import { checkOutputTiming } from '../../core/timing.mjs';
import { estimateFilm, formatEstimate } from '../../core/estimate.mjs';
import { inventoryMaterials } from '../../core/materials.mjs';
import { fail } from '../context.mjs';
import { reviewArtifacts } from '../review-artifacts.mjs';

export function mediaCommands({ pos, opt, log, aspectOpt }) {
  const { registerReview } = reviewArtifacts(log);

  return {
    'estimate': async () => {
      if (!pos[0]) fail('用法：wka estimate <片目录> [--max-shot 秒] [--aspect 9:16]');
      const maxShot = opt('max-shot') === undefined ? null : Number(opt('max-shot'));
      if (maxShot !== null && !(maxShot > 0)) fail('--max-shot 必须是正数（秒）');
      const result = estimateFilm(pos[0], { aspect: aspectOpt(), maxShot });
      log(formatEstimate(result));
      return result.over.length ? 2 : 0;
    },
    'materials': async () => {
      if (!pos[0]) fail('用法：wka materials <片目录> [--frames N]');
      const frames = opt('frames') === undefined ? 3 : Number(opt('frames'));
      if (!Number.isInteger(frames) || frames < 0) fail('--frames 必须是非负整数');
      const { file, items } = inventoryMaterials(pos[0], { frames });
      log(`素材清单：${file}（${items.length} 项${items.some(item => item.frames.length) ? '，视频已抽帧到 review/素材抽帧/' : ''}）`);
      return;
    },
    'still': async () => {
      if (!pos[0]) fail('用法：wka still <片目录>');
      const at = opt('at')
        ? String(opt('at')).split(',').map((x) => {
            const [shot, t] = x.split(':');
            return { shot, t: parseFloat(t) };
          })
        : null;
      await checkMainUnchanged(pos[0], { aspect: aspectOpt(), log });
      const r = await stills(pos[0], { at, frames: Number(opt('frames', 1)), proxy: !!opt('proxy'), aspect: aspectOpt(), wordReview: !!opt('word-review'), log });
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
  };
}
