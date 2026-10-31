import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { shotHashes } from '../../core/job.mjs';
import { loadFilm } from '../../core/film-context.mjs';
import { snapshotMain, checkMainUnchanged } from '../../core/approval.mjs';
import { commitSnapshot } from '../../core/project.mjs';
import { readProgress, PRODUCTION_STEPS, REVIEW_GATES, LAST_STEP, commitSignoff } from '../../core/state.mjs';
import { runQc } from '../../core/qc.mjs';
import { requireSubtitlePreflight } from '../../core/subtitle-preflight.mjs';
import { requireTiming } from '../../core/timing.mjs';
import { checkShotSizes } from '../../core/shot-sizes.mjs';
import { implementationState } from '../../core/operations.mjs';
import { writeDelivery, readDecisions } from '../../core/delivery.mjs';
import { writeFinalDelivery, formatFinalDelivery, recordFinalEvidence, prepareFinalApproval, commitFinalApproval } from '../../core/final-delivery.mjs';
import { digest, readJson, atomicJson, treeEvidence } from '../../core/evidence.mjs';
import { fail } from '../context.mjs';

const SHOT_SIZE_STEP = 5;
const SUBTITLES_STEP = 10;
const PROXY_STEP = 11;
const FINAL_REVIEW_STEP = 13;
const VARIANT_STEP = 14;

export function reviewCommands({ pos, opt, log, aspectOpt }) {
  return {
    'delivery': async () => {
      if(!pos[0]) throw new Error('用法：wka delivery <片目录> --host codex|claude|generic [--json]');
      if(opt('record')&&!opt('final'))throw new Error('--record 需要 --final');
      if(opt('record'))recordFinalEvidence(pos[0]);
      const report=(opt('final')?writeFinalDelivery:writeDelivery)(pos[0],{host:opt('host','codex'),aspect:aspectOpt()});
      log(opt('json')?JSON.stringify(report,null,2):opt('final')?formatFinalDelivery(report):[...report.links.map(l=>'- '+l),...report.errors].join('\n'));
      return report.ok ? 0 : 2;
    },
    'signoff': async () => {
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
    },
    'qc': async () => {
      if (!pos[0]) fail('用法：wka qc <片目录> [--proxy] [--aspect 9:16]');
      const r = await runQc(pos[0], { proxy: !!opt('proxy'), aspect: aspectOpt(), log });
      return r.ok ? 0 : 2;
    }
  };
}
