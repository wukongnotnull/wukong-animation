import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as delivery from '../../plugin/engine/core/delivery.mjs';
import * as final from '../../plugin/engine/core/final-delivery.mjs';

function fixture(t) {
  const prior=process.env.WKA_JIANYING_PROCESS;process.env.WKA_JIANYING_PROCESS='wka-nonexistent-test-process';
  t.after(()=>{if(prior===undefined)delete process.env.WKA_JIANYING_PROCESS;else process.env.WKA_JIANYING_PROCESS=prior;});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'最终交付 [中] #% '));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'.wka'));fs.mkdirSync(path.join(dir,'shots'));
  fs.writeFileSync(path.join(dir,'shots/s01.js'),'function draw() {}');
  fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify({title:'film',style:'ink-wash',size:[160,90],fps:10,seed:1,shots:[{id:'s01',file:'shots/s01.js',duration:1}],export:{name:'影片',formats:['mp4','jianying']}}));
  fs.writeFileSync(path.join(dir,'.wka/decisions.json'),JSON.stringify({version:1,...Object.fromEntries(Object.entries({delivery:'video-and-draft',aspects:['16:9'],subtitles:{mode:'none',bilingual:false}}).map(([k,value])=>[k,{status:'confirmed',value,source:'用户明确确认'}]))}));
  return dir;
}

test('A1/A2 final contract ignores last command and review clutter; query is read-only',t=>{
  assert.equal(typeof delivery.finalDeliveryReport,'function','最终交付尚无独立入口');
  const dir=fixture(t);fs.mkdirSync(path.join(dir,'review'));
  for(let n=0;n<2044;n++)fs.writeFileSync(path.join(dir,'review',`抽帧-${n}.png`),'历史');
  fs.mkdirSync(path.join(dir,'.cache'));fs.writeFileSync(path.join(dir,'.cache/active-command.json'),JSON.stringify({argv:['final',dir,'--formats','jianying']}));
  const before=fs.readdirSync(dir,{recursive:true});
  const report=delivery.finalDeliveryReport(dir);
  assert.equal(report.version,2);assert.equal(report.ok,false);
  assert.deepEqual(report.items.map(i=>i.slot),['16:9/video/mp4/clean','16:9/draft/jianying']);
  assert.equal(report.audit.files.length,2044);
  assert.deepEqual(fs.readdirSync(dir,{recursive:true}),before);
  assert.equal(fs.existsSync(path.join(dir,'.wka/final-delivery.json')),false);
});

test('A3 generated video remains linked while draft is missing; provenance is not approval',t=>{
  assert.equal(typeof final.captureFinalGeneration,'function');
  const dir=fixture(t),file=path.join(dir,'影片.mp4'),font=path.join(dir,'font.ttf');
  fs.writeFileSync(font,'actual font bytes');
  const generation=final.captureFinalGeneration(dir,{slot:'16:9/video/mp4/clean',fontFiles:[font]});
  fs.writeFileSync(file,'actual generated video');
  final.recordFinalArtifact(dir,{generation,path:file,stage:'encode:mp4',technical:{status:'passed',checks:['timing'],errors:[]}});
  const report=final.finalDeliveryReport(dir),video=report.items[0];
  assert.equal(report.status,'partial');assert.equal(report.summary.ready,1);assert.equal(report.ok,false);
  assert.equal(video.freshness,'current');assert.equal(video.acceptance,'pending');assert.equal(video.section,'待审文件');
  assert.ok(video.link);assert.equal(report.items[1].link,undefined);assert.equal(report.blocks[1].actor,'agent');
  assert.equal(video.openStatus,'not-tested');
});

test('A6 subtitle dependencies separate English and layout from Chinese SRT',t=>{
  assert.equal(typeof final.captureFinalGeneration,'function');
  const dir=fixture(t),film=JSON.parse(fs.readFileSync(path.join(dir,'film.json')));
  film.subtitles={mode:'both',bilingual:true};fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(film));
  const decisions=JSON.parse(fs.readFileSync(path.join(dir,'.wka/decisions.json')));decisions.subtitles.value={mode:'both',bilingual:true};fs.writeFileSync(path.join(dir,'.wka/decisions.json'),JSON.stringify(decisions));
  fs.writeFileSync(path.join(dir,'subtitles.srt'),'1\n00:00:00,000 --> 00:00:01,000\n中文\n');
  fs.writeFileSync(path.join(dir,'subtitles.en.json'),'[{"text":"English"}]');
  for(const lang of ['zh','en']) {
    const slot=`16:9/subtitle/${lang}`,generation=final.captureFinalGeneration(dir,{slot}),file=path.join(dir,lang+'.srt');fs.writeFileSync(file,'字幕');
    final.recordFinalArtifact(dir,{generation,path:file,stage:'sidecar',technical:{status:'passed',checks:['subtitle-integrity'],errors:[]}});
  }
  fs.writeFileSync(path.join(dir,'subtitles.en.json'),'[{"text":"Changed"}]');
  fs.writeFileSync(path.join(dir,'subtitle-layout.json'),'{"version":1,"aspects":{}}');
  const report=final.finalDeliveryReport(dir);
  assert.equal(report.items.find(i=>i.format==='zh').freshness,'current');
  assert.equal(report.items.find(i=>i.format==='en').freshness,'changed');
});

test('A7/A10 corrupt ledger and special files never become success',t=>{
  assert.equal(typeof final.captureFinalGeneration,'function');
  const dir=fixture(t),file=path.join(dir,'.wka/final-delivery.json');
  fs.writeFileSync(file,'{"version":1,"contracts":[],"artifacts":[{}],"approvals":[]}');
  assert.throws(()=>final.finalDeliveryReport(dir),/账本/);
  fs.rmSync(file);const draft=path.join(dir,'draft');fs.mkdirSync(draft);fs.symlinkSync(path.join(dir,'film.json'),path.join(draft,'external'));
  assert.throws(()=>final.deliverySnapshot(draft),/链接或特殊/);
});

function draftArtifact(dir) {
  const draft=path.join(dir,'草稿 (外部)');fs.mkdirSync(draft);
  fs.writeFileSync(path.join(draft,'draft_content.json'),JSON.stringify({materials:{videos:[],audios:[]},tracks:[]}));
  fs.writeFileSync(path.join(draft,'.wka-complete.json'),'original exporter marker');
  const generation=final.captureFinalGeneration(dir,{slot:'16:9/draft/jianying',fontFiles:[path.join(dir,'shots/s01.js')]});
  final.recordFinalArtifact(dir,{generation,path:draft,stage:'draft-export',technical:{status:'passed',checks:['timeline'],errors:[]}});
  return draft;
}

test('A4/A5/A10 revision rejects mutations and manual draft approval preserves original marker',t=>{
  assert.equal(typeof final.prepareFinalApproval,'function');
  const dir=fixture(t),draft=draftArtifact(dir),file=path.join(draft,'draft_content.json');
  const before=fs.readFileSync(path.join(draft,'.wka-complete.json'));
  const first=final.finalDeliveryReport(dir).reviewSets[15].deliveryRevision;
  fs.writeFileSync(file,JSON.stringify({materials:{videos:[],audios:[]},tracks:[],name:'user edit'}));
  assert.throws(()=>final.prepareFinalApproval(dir,{step:15,revision:first,source:'用户',note:'通过'}),/版本|变化/);
  const revision=final.finalDeliveryReport(dir).reviewSets[15].deliveryRevision;
  const args={id:'user-approval-15',step:15,revision,source:'用户本轮明确回复',note:'已保存并退出，草稿已打开检查',openEvidence:{status:'opened',source:'用户明确报告'}};
  const approval=final.prepareFinalApproval(dir,args);
  // 模拟既有流程签批已持久化，不通过新模块伪造 state。
  fs.writeFileSync(path.join(dir,'.wka/state.json'),JSON.stringify({flow:5,step:15,history:[{step:15,approvalId:args.id,note:args.note}]}));
  final.commitFinalApproval(dir,approval);final.commitFinalApproval(dir,approval);
  let report=final.finalDeliveryReport(dir),item=report.items.find(i=>i.kind==='draft');
  assert.equal(item.acceptance,'accepted');assert.equal(item.openStatus,'opened');assert.equal(item.freshness,'current');
  const ledger=JSON.parse(fs.readFileSync(path.join(dir,'.wka/final-delivery.json')));assert.equal(ledger.approvals.length,1);
  assert.deepEqual(fs.readFileSync(path.join(draft,'.wka-complete.json')),before);
  fs.writeFileSync(file,JSON.stringify({materials:{videos:[],audios:[]},tracks:[],name:'edit again'}));
  report=final.finalDeliveryReport(dir);item=report.items.find(i=>i.kind==='draft');
  assert.equal(item.acceptance,'changed-after-acceptance');assert.match(item.reasons.join(' '),/验收后磁盘/);
  assert.equal(item.openStatus,'not-tested');
});

test('A8 legacy step and vague note are history only, old flow bytes remain unchanged',t=>{
  const dir=fixture(t),draft=draftArtifact(dir),state=path.join(dir,'.wka/state.json');void draft;
  fs.writeFileSync(state,JSON.stringify({flow:3,step:14,history:[{step:14,note:'草稿通过',approvalId:'legacy'}]}));
  const bytes=fs.readFileSync(state),report=final.finalDeliveryReport(dir),item=report.items.find(i=>i.kind==='draft');
  assert.equal(item.acceptance,'historical-only');assert.match(item.reasons.join(' '),/历史已验收/);
  assert.deepEqual(fs.readFileSync(state),bytes);
});

test('A5 native variant inherits only approved exact source, never claims native playback',t=>{
  const dir=fixture(t),file=path.join(dir,'film.json'),film=JSON.parse(fs.readFileSync(file));film.variants={'9:16':{}};fs.writeFileSync(file,JSON.stringify(film));
  const decisions=JSON.parse(fs.readFileSync(path.join(dir,'.wka/decisions.json')));decisions.aspects.value.push('9:16');fs.writeFileSync(path.join(dir,'.wka/decisions.json'),JSON.stringify(decisions));
  const font=path.join(dir,'font.ttf');fs.writeFileSync(font,'font');fs.mkdirSync(path.join(dir,'review'));
  const proxy=path.join(dir,'review/小样-9x16.mp4');fs.writeFileSync(proxy,'proxy');
  const slot='9:16/source/proxy',projection={slot};
  final.recordFinalArtifact(dir,{generation:final.captureFinalGeneration(dir,{slot,fontFiles:[font],descriptor:{slot,aspect:'9:16',kind:'video',format:'mp4',flavor:'clean',projection,contractDigest:'source'}}),path:proxy,stage:'review:proxy',technical:{status:'passed',checks:['timing'],errors:[]}});
  const revision=final.finalDeliveryReport(dir).reviewSets[14].deliveryRevision;
  const prepared=final.prepareFinalApproval(dir,{id:'source-14',step:14,revision,source:'用户明确批准副版小样',note:'小样通过'});
  fs.writeFileSync(path.join(dir,'.wka/state.json'),JSON.stringify({flow:5,history:[{step:14,approvalId:'source-14'}]}));final.commitFinalApproval(dir,prepared);
  const native=path.join(dir,'影片-9x16.mp4');fs.writeFileSync(native,'native');
  final.recordFinalArtifact(dir,{generation:final.captureFinalGeneration(dir,{slot:'9:16/video/mp4/clean',fontFiles:[font]}),path:native,stage:'encode:mp4',technical:{status:'passed',checks:['timing'],errors:[]}});
  let item=final.finalDeliveryReport(dir).items.find(i=>i.path===native);assert.equal(item.acceptance,'accepted');assert.equal(item.approval.type,'inherited');assert.equal(item.openStatus,'not-tested');
  fs.appendFileSync(path.join(dir,'shots/s01.js'),'// change');item=final.finalDeliveryReport(dir).items.find(i=>i.path===native);assert.notEqual(item.acceptance,'accepted');
});

test('A6 variant overrides and notes do not stale main; shared picture does',t=>{
  const dir=fixture(t),file=path.join(dir,'film.json'),film=JSON.parse(fs.readFileSync(file));film.variants={'9:16':{}};fs.writeFileSync(file,JSON.stringify(film));
  fs.writeFileSync(path.join(dir,'shots/s01.9x16.js'),'variant');
  const decisions=JSON.parse(fs.readFileSync(path.join(dir,'.wka/decisions.json')));decisions.aspects.value.push('9:16');fs.writeFileSync(path.join(dir,'.wka/decisions.json'),JSON.stringify(decisions));
  for(const aspect of ['16:9','9:16']) {
    const generation=final.captureFinalGeneration(dir,{slot:`${aspect}/video/mp4/clean`,fontFiles:[path.join(dir,'film.json')]}),out=path.join(dir,aspect.replace(':','x')+'.mp4');fs.writeFileSync(out,'video');final.recordFinalArtifact(dir,{generation,path:out,stage:'encode:mp4',technical:{status:'passed'}});
  }
  fs.appendFileSync(path.join(dir,'shots/s01.9x16.js'),' changed');fs.writeFileSync(path.join(dir,'review-notes.json'),'{"version":1}');
  let report=final.finalDeliveryReport(dir);assert.equal(report.items.find(i=>i.kind==='video'&&i.aspect==='16:9').freshness,'current');assert.equal(report.items.find(i=>i.kind==='video'&&i.aspect==='9:16').freshness,'changed');
  fs.appendFileSync(path.join(dir,'shots/s01.js'),' changed');report=final.finalDeliveryReport(dir);assert.equal(report.items.find(i=>i.kind==='video'&&i.aspect==='16:9').freshness,'changed');
});

test('A10 identical successful export reuses evidence identity and record retries preserve approval',t=>{
  const dir=fixture(t),file=path.join(dir,'影片.mp4'),font=path.join(dir,'font.ttf');fs.writeFileSync(font,'font');
  const save=()=>{const generation=final.captureFinalGeneration(dir,{slot:'16:9/video/mp4/clean',fontFiles:[font]});fs.writeFileSync(file,'same bytes');return final.recordFinalArtifact(dir,{generation,path:file,stage:'encode:mp4',technical:{status:'passed'}});};
  const first=save(),second=save();assert.equal(first.id,second.id);
  const revision=final.finalDeliveryReport(dir).reviewSets[13].deliveryRevision;
  const prepared=final.prepareFinalApproval(dir,{id:'same-13',step:13,revision,source:'用户',note:'通过'});
  fs.writeFileSync(path.join(dir,'.wka/state.json'),JSON.stringify({flow:5,history:[{step:13,approvalId:'same-13'}]}));final.commitFinalApproval(dir,prepared);
  save();assert.equal(final.finalDeliveryReport(dir).items[0].acceptance,'accepted');
  final.recordFinalEvidence(dir);assert.equal(final.finalDeliveryReport(dir).items[0].acceptance,'accepted');
});

test('A10 saved generation receipt recovers ledger failure without generating media',t=>{
  const dir=fixture(t),file=path.join(dir,'影片.mp4'),generation=final.captureFinalGeneration(dir,{slot:'16:9/video/mp4/clean'});
  fs.writeFileSync(file,'video');fs.mkdirSync(path.join(dir,'.wka/final-delivery.json'));
  assert.throws(()=>final.recordFinalArtifact(dir,{generation,path:file,stage:'encode:mp4',technical:{status:'passed'}}),/final-delivery/);
  assert.equal(fs.readFileSync(file,'utf8'),'video');fs.rmdirSync(path.join(dir,'.wka/final-delivery.json'));
  assert.deepEqual(final.recordFinalEvidence(dir),[generation.id]);assert.deepEqual(final.recordFinalEvidence(dir),[]);
  assert.equal(fs.readFileSync(file,'utf8'),'video');
});
