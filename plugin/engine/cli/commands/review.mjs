import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { shotHashes } from '../../core/job.mjs';
import { loadFilm } from '../../core/film-context.mjs';
import { snapshotMain, checkMainUnchanged } from '../../core/approval.mjs';
import { commitPaths, dirtyReviewPaths } from '../../core/project.mjs';
import { readProgress, PRODUCTION_STEPS, REVIEW_GATES, LAST_STEP, commitSignoff, nextProductionStep, assertActiveProduction } from '../../core/state.mjs';
import { buildManifest, writeManifest, verifyManifest, MANIFEST } from '../../core/delivery-manifest.mjs';
import { runQc } from '../../core/qc.mjs';
import { requireTiming } from '../../core/timing.mjs';
import { checkShotSizes } from '../../core/shot-sizes.mjs';
import { implementationState } from '../../core/operations.mjs';
import { writeDelivery, readDecisions } from '../../core/delivery.mjs';
import { writeFinalDelivery, formatFinalDelivery, recordFinalEvidence, recheckEngineChange, prepareFinalApproval, commitFinalApproval } from '../../core/final-delivery.mjs';
import { digest, readJson, atomicJson, treeEvidence } from '../../core/evidence.mjs';
import { fail } from '../context.mjs';

import { voiceAlignmentStatus } from '../../audio/voice-alignment.mjs';

const SHOT_SIZE_STEP = 4;
const PROXY_STEP = 5;
const FINAL_REVIEW_STEP = 6;
const VARIANT_STEP = 7;

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
    'recheck': async () => {
      if(!pos[0]) throw new Error('用法：wka recheck <片目录> [--accept --note "<复核说明>"]');
      const accept=!!opt('accept'),result=recheckEngineChange(pos[0],{accept,note:opt('note')===true?'':opt('note','')});
      if(!result.items.length){log('没有因引擎变动而过期的交付产物。');return 0;}
      for(const item of result.items) {
        log(`${item.eligible?(accept?'已接受':'可接受'):'不可接受'}：${item.path}`);
        if(item.files.length)log(`  引擎变动：${item.files.slice(0,8).join('、')}${item.files.length>8?` 等 ${item.files.length} 个文件`:''}`);
        if(item.reason)log(`  原因：${item.reason}`);
      }
      if(!accept&&result.items.some(i=>i.eligible))log('\n确认这些变动与本片画面和声音无关后，加 --accept --note "<复核说明>" 接受；旧批准不会沿用，仍须重新签批。');
      return result.items.every(i=>i.eligible&&(!accept||result.added.length))?0:2;
    },
    'signoff': async () => {
      if (!pos[0] || !pos[1]) fail('用法：wka signoff <片目录> "<审片结论>" [--step N]');
      assertActiveProduction(pos[0]);
      const step = opt('step') ? Number(opt('step')) : null;
      if (step && !PRODUCTION_STEPS[step]) fail(`--step 取 1–${LAST_STEP}`);
      let note = pos[1];
      // 第 4 道分镜签批前检查景别；确实要这样拍可以 --force，问题会附在签批记录里
      if (step === SHOT_SIZE_STEP) {
        const problems = checkShotSizes(loadFilm(pos[0], { requireShots: false }).film.shots);
        if (problems.length && !opt('force')) fail(`景别检查未通过，分镜先别签批：\n  ${problems.join('\n  ')}\n  改 film.json 的 shots[].size 和 storyboard.md 的景别栏；确实要这样拍，加 --force`);
        if (problems.length) note = `${note}（景别检查未通过：${problems.join('；')}）`;
      }
      if ([5, 6, 7, 8].includes(step) && !voiceAlignmentStatus(pos[0]).applied) throw new Error('录音定位缺失、待确认、已过期或尚未用于制作，请先核实当前声音并更新小样');
      const pendingFile=path.join(path.resolve(pos[0]),'.wka/pending-approval.json');
      const pending=readJson(pendingFile),id=String(opt('approval-id')||(pending?.status!=='completed'&&pending?.note===note?pending.id:crypto.randomUUID()));
      const revision=opt('delivery-revision');
      if(revision===true)throw new Error('--delivery-revision 需要完整摘要');
      const deliveryApproval=revision?prepareFinalApproval(pos[0],{id,step,revision,source:'用户明确签批（signoff）',note,openEvidence:opt('open-status')?{status:opt('open-status'),source:note}:null}):null;
      const decision = opt('decision') || 'approved';
      if (!['approved', 'changes-requested'].includes(decision)) throw new Error('审阅结论无效');
      const manifest = buildManifest(pos[0], step);
      writeManifest(pos[0], manifest);
      const signature=digest({sources:treeEvidence(path.resolve(pos[0]),(rel,ent)=>ent.isDirectory()&&['.git','.cache','.wka','review','成片','generated','node_modules'].includes(ent.name)),implementation:implementationState(),decisions:readDecisions(pos[0]),shots:step===6||step===7?shotHashes(pos[0]):null,...(revision?{deliveryRevision:revision}:{})});
      if(pending?.id===id&&pending.signature!==signature) throw new Error('待存档批准之后输入已变化，请重新核实审阅，不能沿用旧批准');
      const deliveryProof=deliveryApproval?{deliveryApproval:deliveryApproval.existing&&pending?.deliveryApproval?.review?pending.deliveryApproval:deliveryApproval}:{};
      atomicJson(pendingFile,{id,step,note,signature,status:'prepared',...deliveryProof});
      if (step === FINAL_REVIEW_STEP) {
        const ctx=loadFilm(pos[0]);requireTiming(ctx,{fresh:true,log});
      }
      if (step === PROXY_STEP) {
        const ctx=loadFilm(pos[0]);
        requireTiming(ctx,{proxy:true,fresh:true,log});
      }
      if (step === VARIANT_STEP) {
        const { film } = loadFilm(pos[0]);
        for (const aspect of Object.keys(film.variants || {})) {
          const ctx = loadFilm(pos[0], { aspect });
          const checked = await checkMainUnchanged(pos[0], { aspect, log });
          if (checked && !checked.ok) fail('主版不变检查未通过，不能签批副版；先完成主版复核');
          const proxy = !fs.existsSync(path.join(ctx.variant.cacheDir, 'timing.json'));
          requireTiming(ctx, { proxy, fresh: true, log });
        }
      }
      const label = path.basename(path.resolve(pos[0]));
      const receipts = fs.existsSync(path.join(pos[0], '.wka/final-delivery-receipts')) ? fs.readdirSync(path.join(pos[0], '.wka/final-delivery-receipts')).map(name => '.wka/final-delivery-receipts/' + name) : [];
      const reviewPaths = [...manifest.tracked, MANIFEST, '.wka/state.json', '.wka/pending-approval.json', ...receipts].concat(['.wka/decisions.json', '.wka/final-delivery.json'].filter(file => fs.existsSync(path.join(pos[0], file))));
      const current = readProgress(pos[0]);
      if (current.history.some(h => h.decision === 'changes-requested' && h.reviewSha)) {
        const closed = new Set(current.history.filter(h => h.decision === 'changes-requested').map(h => h.reviewSha));
        const latest = current.history.at(-1);
        if (latest?.decision === 'changes-requested' && closed.has(latest.reviewSha)) throw new Error('这一版已经退回，请重新提交后再签批');
      }
      const verified = verifyManifest(pos[0]);
      if (!verified.ok) throw new Error(verified.reason);
      const prior=readProgress(pos[0]).history.find(h=>h.approvalId===id);
      let main=null,variants=null;
      if(!prior&&decision==='approved'&&step===FINAL_REVIEW_STEP){const snapshot=snapshotMain(pos[0],{log});if(snapshot.missing.length)throw new Error('缺少完整定稿快照，签批存档未提交');main=snapshot.hashes;}
      if(!prior&&decision==='approved'&&step===VARIANT_STEP){const {film}=loadFilm(pos[0]);variants=Object.fromEntries(Object.keys(film.variants||{}).map(aspect=>[aspect,shotHashes(pos[0],{aspect})]));}
      const prepared = [...reviewPaths, ...dirtyReviewPaths(pos[0]), ...receipts, '.wka/final-delivery.json', '.wka/decisions.json', '.wka/state.json', '.wka/pending-approval.json'].filter((file, index, all) => all.indexOf(file) === index && fs.existsSync(path.join(pos[0], file)));
      const review = commitPaths(pos[0], { message: `${label}: 待审 ${PRODUCTION_STEPS[step]}`, paths: prepared }, { log });
      if (readProgress(pos[0]).history.some(h => h.reviewSha === review.sha && h.decision === 'changes-requested')) throw new Error('这一版已经退回，请重新提交后再签批');
      commitSignoff(pos[0],{id,step,note,signature,main,variants,decision,reviewSha:review.sha,advanced:decision==='approved'?nextProductionStep(pos[0],step):null});
      if(decision==='approved'&&deliveryApproval)commitFinalApproval(pos[0],deliveryApproval);
      atomicJson(pendingFile,{id,step,note,signature,status:'completed',decision,git:'committed',sha:review.sha,...deliveryProof});
      const conclusionPaths=['.wka/state.json','.wka/pending-approval.json','.wka/final-delivery.json',...receipts].filter(file=>fs.existsSync(path.join(pos[0],file)));
      const conclusion = commitPaths(pos[0], { message: `${label}: 审阅结论`, paths: conclusionPaths }, { log });
      log(`  ✓ 待审提交 ${review.sha.slice(0, 7)}，结论提交 ${conclusion.sha.slice(0, 7)}`);
      if (step) log(`  进度：第 ${step} 道工序「${PRODUCTION_STEPS[step]}」${REVIEW_GATES[step] ? ' · 审片节点 ' + REVIEW_GATES[step] : ''}`);
      return;
    },
    'qc': async () => {
      if (!pos[0]) fail('用法：wka qc <片目录> [--proxy] [--aspect 9:16]');
      const r = await runQc(pos[0], { proxy: !!opt('proxy'), aspect: aspectOpt(), log });
      return r.ok ? 0 : 2;
    }
  };
}
