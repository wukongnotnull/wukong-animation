import { render, encodeOutputs } from '../../core/job.mjs';
import { loadFilm } from '../../core/film-context.mjs';
import { checkMainUnchanged } from '../../core/approval.mjs';
import { listAspects } from '../../core/variants.mjs';
import { readProgress, variantStale, staleVariants } from '../../core/state.mjs';
import { readDecisions, decisionConflicts } from '../../core/delivery.mjs';
import { finalFontFiles, finalFontUnknown } from '../../core/final-delivery.mjs';
import { draftAudioDifference } from '../../core/review-evidence.mjs';
import { fail } from '../context.mjs';
import { reviewArtifacts } from '../review-artifacts.mjs';

export function finalCommands({ pos, opt, log, aspectOpt }) {
  const { registerReview } = reviewArtifacts(log);
  async function cmdFinalAll(filmDir, o) {
    if (o.aspect !== 'all') return cmdFinal(filmDir, o);
    const { film } = loadFilm(filmDir);
    const stale = staleVariants(readProgress(filmDir));
    if (stale.length) fail(`${stale.join('、')} 副版已过期：主版在第 7 道重新签批过，先重做第 8 道「调整画幅」并签批，再出全部画幅`);
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
        fail(`${ctx.variant.aspect} 副版已过期：主版在第 7 道重新签批过，先重做第 8 道「调整画幅」并签批，再出副版成片`);
      }
      const mainCheck = await checkMainUnchanged(filmDir, { aspect: o.aspect, log });
      if (mainCheck?.timingChanged) fail('主版时间轴已变化，请先明确重出主版并完成第 7 道成片验收，再导出副版');
    }
    const formats = o.formats ? String(o.formats).split(',') : ctx.film.export?.formats || ['mp4'];
    const draftOnly=formats.every(f=>f==='jianying');
    // render 内先准备真实录音与混音，再制作画面；同一批只运行一次配乐脚本。
    const { video, job, segments, soundtrack } = await render(filmDir, {...o,segmentsOnly:draftOnly});
    const { mix: audio, tracks, voices, loudness } = soundtrack;
    ctx=loadFilm(filmDir,{aspect:o.aspect});
    const visual = formats.filter(f => f !== 'jianying'), drafts = formats.filter(f => f === 'jianying');
    const outs = visual.length ? await encodeOutputs(filmDir, { video, audio, proxy: o.proxy, formats: visual, aspect: o.aspect, force:o.force, fontFiles:finalFontFiles(job.fonts), unknownReasons:finalFontUnknown(job.fonts), log }) : [];
    if (drafts.length) {
      const difference=draftAudioDifference(ctx,tracks,loudness??null);
      registerReview(filmDir,'draft-audio-difference',difference.files,o.aspect);
      log(`[${ctx.variant.aspect} 高清 · draft-export] 写入前说明：${difference.report.note}\n${difference.files[0]}`);
      // 时间线：给需要分镜 / 分轨信息的导出器（如剪映草稿）用
      const timeline = { title: ctx.variant.title, size: job.film.size, fps: job.film.fps, duration: job.timeline.duration, shots: segments, tracks, voices };
      outs.push(...(await encodeOutputs(filmDir, { video, audio, timeline, proxy: o.proxy, formats: drafts, aspect: o.aspect,force:o.force,fontFiles:finalFontFiles(job.fonts),unknownReasons:finalFontUnknown(job.fonts), log })));
    }
    log(`\n完成 ✓\n${outs.map((x) => `  ${x}`).join('\n')}`);
  }
  return {
    'final': async () => {
      if (!pos[0]) fail('用法：wka final <片目录> [--aspect 9:16|all]');
      if (opt('confirm-subtitles')) fail('字幕能力已取消，不能导出或复核字幕。');
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
