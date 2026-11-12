import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { qcSource } from '../../plugin/engine/core/qc-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as delivery from '../../plugin/engine/core/delivery.mjs';
import * as final from '../../plugin/engine/core/final-delivery.mjs';
import { rememberArtifacts } from '../../plugin/engine/core/operations.mjs';
import { digest, fileDigest } from '../../plugin/engine/core/evidence.mjs';

function fixture(t) {
  const prior=process.env.WKA_JIANYING_PROCESS;process.env.WKA_JIANYING_PROCESS='wka-nonexistent-test-process';
  t.after(()=>{if(prior===undefined)delete process.env.WKA_JIANYING_PROCESS;else process.env.WKA_JIANYING_PROCESS=prior;});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'最终交付 [中] #% '));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  initializeProduction(dir);fs.mkdirSync(path.join(dir,'shots'));
  fs.writeFileSync(path.join(dir,'shots/s01.js'),'function draw() {}');
  fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify({title:'film',style:'ink-wash',size:[160,90],fps:10,seed:1,shots:[{id:'s01',file:'shots/s01.js',duration:1}],export:{name:'影片',formats:['mp4','jianying']}}));
  fs.writeFileSync(path.join(dir,'.wka/decisions.json'),JSON.stringify({version:1,...Object.fromEntries(Object.entries({delivery:'video-and-draft',aspects:['16:9']}).map(([k,value])=>[k,{status:'confirmed',value,source:'用户明确确认'}]))}));
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
  assert.doesNotMatch(final.formatFinalDelivery(report),/16:9\/video\/mp4/,'用户清单用产物名称，不展示内部槽位键');
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
  const first=final.finalDeliveryReport(dir).reviewSets[8].deliveryRevision;
  fs.writeFileSync(file,JSON.stringify({materials:{videos:[],audios:[]},tracks:[],name:'user edit'}));
  assert.throws(()=>final.prepareFinalApproval(dir,{step:8,revision:first,source:'用户',note:'通过'}),/版本|变化/);
  const revision=final.finalDeliveryReport(dir).reviewSets[8].deliveryRevision;
  const args={id:'user-approval-15',step:8,revision,source:'用户本轮明确回复',note:'已保存并退出，草稿已打开检查',openEvidence:{status:'opened',source:'用户明确报告'}};
  const approval=final.prepareFinalApproval(dir,args);
  // 模拟既有流程签批已持久化，不通过新模块伪造 state。
  fs.writeFileSync(path.join(dir,'.wka/state.json'),JSON.stringify({flow:7,step:8,history:[{step:8,approvalId:args.id,note:args.note}]}));
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

test('A8 legacy final delivery cannot be adopted or written; state bytes remain unchanged',t=>{
  const dir=fixture(t);draftArtifact(dir);const state=path.join(dir,'.wka/state.json');
  fs.writeFileSync(state,JSON.stringify({flow:3,step:14,history:[{step:14,note:'草稿通过'}]}));
  const before=fs.readFileSync(state);
  assert.throws(()=>final.finalDeliveryReport(dir),{code:'WKA_LEGACY_READONLY'});
  assert.throws(()=>final.recordFinalEvidence(dir),{code:'WKA_LEGACY_READONLY'});
  assert.deepEqual(fs.readFileSync(state),before);
});

test('A5 variant approval binds the delivered high-definition video, not the preview',t=>{
  const dir=fixture(t),file=path.join(dir,'film.json'),film=JSON.parse(fs.readFileSync(file));film.variants={'9:16':{}};fs.writeFileSync(file,JSON.stringify(film));
  const decisions=JSON.parse(fs.readFileSync(path.join(dir,'.wka/decisions.json')));decisions.aspects.value.push('9:16');fs.writeFileSync(path.join(dir,'.wka/decisions.json'),JSON.stringify(decisions));
  const font=path.join(dir,'font.ttf');fs.writeFileSync(font,'font');fs.mkdirSync(path.join(dir,'review'));
  fs.writeFileSync(path.join(dir,'review/小样-9x16.mp4'),'proxy');
  const native=path.join(dir,'影片-9x16.mp4');
  assert.equal(final.finalDeliveryReport(dir).reviewSets[7].bindings.every(b=>b.slot.startsWith('9:16/video/')),true);
  assert.throws(()=>final.prepareFinalApproval(dir,{id:'v-early',step:7,revision:final.finalDeliveryReport(dir).reviewSets[7].deliveryRevision,source:'用户',note:'通过'}),/缺失|不可读|没有实际产物/);
  fs.writeFileSync(native,'native');
  final.recordFinalArtifact(dir,{generation:final.captureFinalGeneration(dir,{slot:'9:16/video/mp4/clean',fontFiles:[font]}),path:native,stage:'encode:mp4',technical:{status:'passed',checks:['timing'],errors:[]}});
  const revision=final.finalDeliveryReport(dir).reviewSets[7].deliveryRevision;
  const prepared=final.prepareFinalApproval(dir,{id:'variant-7',step:7,revision,source:'用户明确批准副版成片',note:'副版成片通过'});
  assert.equal(prepared.approval.type,'direct');assert.deepEqual(prepared.approval.bindings.map(b=>b.path),[native]);
  fs.writeFileSync(path.join(dir,'.wka/state.json'),JSON.stringify({flow:7,step:8,history:[{step:7,approvalId:'variant-7'}]}));final.commitFinalApproval(dir,prepared);
  let item=final.finalDeliveryReport(dir).items.find(i=>i.path===native);assert.equal(item.acceptance,'accepted');assert.equal(item.approval.type,'direct');
  fs.appendFileSync(path.join(dir,'shots/s01.js'),'// change');item=final.finalDeliveryReport(dir).items.find(i=>i.path===native);assert.notEqual(item.acceptance,'accepted');
});

test('A6 variant overrides and notes do not stale main; shared picture does',t=>{
  const dir=fixture(t),file=path.join(dir,'film.json'),film=JSON.parse(fs.readFileSync(file));film.variants={'9:16':{}};fs.writeFileSync(file,JSON.stringify(film));
  fs.writeFileSync(path.join(dir,'shots/s01.9x16.js'),'variant');
  const decisions=JSON.parse(fs.readFileSync(path.join(dir,'.wka/decisions.json')));decisions.aspects.value.push('9:16');fs.writeFileSync(path.join(dir,'.wka/decisions.json'),JSON.stringify(decisions));
  for(const aspect of ['16:9','9:16']) {
    const generation=final.captureFinalGeneration(dir,{slot:`${aspect}/video/mp4/clean`,fontFiles:[path.join(dir,'film.json')]}),out=path.join(dir,aspect.replace(':','x')+'.mp4');fs.writeFileSync(out,'video');final.recordFinalArtifact(dir,{generation,path:out,stage:'encode:mp4',technical:{status:'passed'}});
  }
  fs.appendFileSync(path.join(dir,'shots/s01.9x16.js'),' changed');fs.writeFileSync(path.join(dir,'.wka/review-notes.json'),'{"version":1}');
  let report=final.finalDeliveryReport(dir);assert.equal(report.items.find(i=>i.kind==='video'&&i.aspect==='16:9').freshness,'current');assert.equal(report.items.find(i=>i.kind==='video'&&i.aspect==='9:16').freshness,'changed');
  fs.appendFileSync(path.join(dir,'shots/s01.js'),' changed');report=final.finalDeliveryReport(dir);assert.equal(report.items.find(i=>i.kind==='video'&&i.aspect==='16:9').freshness,'changed');
  assert.match(JSON.stringify(report.items.find(i=>i.kind==='video'&&i.aspect==='16:9')),/相关输入已变：picture（shots\/s01\.js）/);
});

test('A10 identical successful export reuses evidence identity and record retries preserve approval',t=>{
  const dir=fixture(t),file=path.join(dir,'影片.mp4'),font=path.join(dir,'font.ttf');fs.writeFileSync(font,'font');
  const save=()=>{const generation=final.captureFinalGeneration(dir,{slot:'16:9/video/mp4/clean',fontFiles:[font]});fs.writeFileSync(file,'same bytes');return final.recordFinalArtifact(dir,{generation,path:file,stage:'encode:mp4',technical:{status:'passed'}});};
  const first=save(),second=save();assert.equal(first.id,second.id);
  const revision=final.finalDeliveryReport(dir).reviewSets[6].deliveryRevision;
  const prepared=final.prepareFinalApproval(dir,{id:'same-13',step:6,revision,source:'用户',note:'通过'});
  fs.writeFileSync(path.join(dir,'.wka/state.json'),JSON.stringify({flow:7,step:8,history:[{step:6,approvalId:'same-13'}]}));final.commitFinalApproval(dir,prepared);
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

test('A7 dynamic audio and missing fonts remain unknown without touching operations',t=>{
  const dir=fixture(t),file=path.join(dir,'film.json'),film=JSON.parse(fs.readFileSync(file));film.audio={build:'audio/build.mjs'};fs.writeFileSync(file,JSON.stringify(film));
  const generation=final.captureFinalGeneration(dir,{slot:'16:9/video/mp4/clean'}),out=path.join(dir,'影片.mp4');fs.writeFileSync(out,'video');final.recordFinalArtifact(dir,{generation,path:out,stage:'encode:mp4',technical:{status:'passed'}});
  const report=final.finalDeliveryReport(dir);assert.equal(report.items[0].freshness,'unknown');assert.match(report.items[0].reasons.join(' '),/audio.build/);assert.match(report.items[0].reasons.join(' '),/字体/);assert.equal(fs.existsSync(path.join(dir,'.wka/operations.json')),false);
});

test('A10 unstable scan and a running native editor reject approval',t=>{
  const dir=fixture(t),draft=draftArtifact(dir),file=path.join(draft,'draft_content.json'),read=fs.readdirSync;
  // Change the content between two directory scans, independently of the file read API.
  let count=0;t.mock.method(fs,'readdirSync',function(name,...args){const entries=read.call(fs,name,...args);if(name===draft&&++count===2)fs.appendFileSync(file,' ');return entries;});
  assert.throws(()=>final.deliverySnapshot(draft),/扫描期间/);t.mock.restoreAll();
  if(process.platform==='darwin') {
    process.env.WKA_JIANYING_PROCESS=path.basename(process.execPath);
    const revision=final.finalDeliveryReport(dir).reviewSets[8].deliveryRevision;
    assert.throws(()=>final.prepareFinalApproval(dir,{id:'running',step:8,revision,source:'用户',note:'通过'}),/仍在运行/);
  }
});

test('deliverySnapshot keeps two independent complete passes with bounded file reads',t=>{
  const dir=fixture(t),file=path.join(dir,'large.bin'),body=Buffer.alloc(2*1024*1024+17,19);fs.writeFileSync(file,body);
  const expected=digest(body),whole=fs.readFileSync,open=fs.openSync,chunk=fs.readSync,close=fs.closeSync,fds=new Set();let bytes=0,passes=0;
  t.mock.method(fs,'readFileSync',function(name,...args){assert.notEqual(name,file,'delivery snapshot must not allocate the entire file');return whole.call(this,name,...args);});
  t.mock.method(fs,'openSync',function(name,...args){const fd=open.call(this,name,...args);if(name===file){fds.add(fd);passes++;}return fd;});
  t.mock.method(fs,'readSync',function(fd,buffer,offset,length,position){if(fds.has(fd))assert.ok(buffer.length<=1024*1024&&length<=1024*1024);const n=chunk.call(this,fd,buffer,offset,length,position);if(fds.has(fd))bytes+=n;return n;});
  t.mock.method(fs,'closeSync',function(fd){fds.delete(fd);return close.call(this,fd);});
  const snapshot=final.deliverySnapshot(file);assert.equal(snapshot.entries[0].sha256,expected);
  assert.equal(bytes,body.length*2);assert.equal(passes,2);assert.equal(fds.size,0);
});

test('A8 complete pending version proof can be recorded after state commit, never a vague note',t=>{
  const dir=fixture(t);draftArtifact(dir);
  const revision=final.finalDeliveryReport(dir).reviewSets[8].deliveryRevision;
  const prepared=final.prepareFinalApproval(dir,{id:'recover-15',step:8,revision,source:'用户本次明确验收',note:'通过'});
  fs.writeFileSync(path.join(dir,'.wka/state.json'),JSON.stringify({flow:7,step:8,history:[{step:8,approvalId:'recover-15'}]}));
  fs.writeFileSync(path.join(dir,'.wka/pending-approval.json'),JSON.stringify({id:'recover-15',deliveryApproval:prepared,status:'prepared'}));
  const state=fs.readFileSync(path.join(dir,'.wka/state.json'));final.recordFinalEvidence(dir);
  assert.equal(final.finalDeliveryReport(dir).items.find(i=>i.kind==='draft').acceptance,'accepted');
  assert.deepEqual(fs.readFileSync(path.join(dir,'.wka/state.json')),state);
});

test('A11 font URLs preserve parentheses in actual work directory',()=>{
  assert.deepEqual(final.finalFontFiles({css:"@font-face{src:url('file:///tmp/film%20(%E4%B8%AD)/font.ttf');}"}),['/tmp/film (中)/font.ttf']);
});

test('A5 known current QC hard errors cannot be bypassed by a final approval note',t=>{
  const dir=fixture(t),file=path.join(dir,'影片.mp4');fs.mkdirSync(path.join(dir,'.cache/16x9'),{recursive:true});fs.mkdirSync(path.join(dir,'review/QC'),{recursive:true});
  const decisionFile=path.join(dir,'.wka/decisions.json'),decisions=JSON.parse(fs.readFileSync(decisionFile));decisions.delivery.value='video';fs.writeFileSync(decisionFile,JSON.stringify(decisions));
  const video=path.join(dir,'.cache/16x9/video.mp4');fs.writeFileSync(video,'video');fs.writeFileSync(file,'video');
  final.recordFinalArtifact(dir,{generation:final.captureFinalGeneration(dir,{slot:'16:9/video/mp4/clean',fontFiles:[path.join(dir,'shots/s01.js')]}),path:file,stage:'encode:mp4',technical:{status:'passed'}});
  const qc=path.join(dir,'review/QC/QC报告-16x9.json');fs.writeFileSync(qc,JSON.stringify({issues:[{kind:'空帧',shot:'s01',t:0.5,msg:'no content'}]}));
  const source=qcSource(path.join(dir,'.cache/16x9'));
  rememberArtifacts(dir,{stage:'review:qc',aspect:'16:9',signature:source,outputs:[qc],value:qc});
  const report=final.finalDeliveryReport(dir);assert.equal(report.items[0].technical,'hard-error');assert.equal(report.status,'incomplete');
  assert.throws(()=>final.prepareFinalApproval(dir,{id:'hard',step:6,revision:report.reviewSets[6].deliveryRevision,source:'用户',note:'通过'}),/技术错误/);
});

test('A6 a word anchor actually referenced by the picture invalidates that picture',t=>{
  const dir=fixture(t),shot=path.join(dir,'shots/s01.js');fs.writeFileSync(shot,"wk.shot({render(ctx,t,s){s.cueIn('word:anchor');}});");
  const sync=path.join(dir,'sync-points.json'),points={version:1,points:[{id:'anchor',voice:'v',text:'词',method:'estimated',range:[0,0.2]}]};fs.writeFileSync(sync,JSON.stringify(points));
  const generation=final.captureFinalGeneration(dir,{slot:'16:9/video/mp4/clean',fontFiles:[shot]}),out=path.join(dir,'影片.mp4');fs.writeFileSync(out,'video');final.recordFinalArtifact(dir,{generation,path:out,stage:'encode:mp4',technical:{status:'passed'}});
  points.points[0].range=[0.1,0.3];fs.writeFileSync(sync,JSON.stringify(points));
  assert.equal(final.finalDeliveryReport(dir).items[0].freshness,'changed');
});

test('A10 structurally corrupt dependency evidence is diagnosed as a ledger error',t=>{
  const dir=fixture(t);draftArtifact(dir);const file=path.join(dir,'.wka/final-delivery.json'),data=JSON.parse(fs.readFileSync(file));data.artifacts[0].dependencies={groups:null,unknown:123};fs.writeFileSync(file,JSON.stringify(data));
  assert.throws(()=>final.finalDeliveryReport(dir),/账本/);
});

test('A7 actual encoder identity is recorded and unknown tool changes do not pass as current',t=>{
  const dir=fixture(t),generation=final.captureFinalGeneration(dir,{slot:'16:9/video/mp4/clean',fontFiles:[path.join(dir,'shots/s01.js')]});
  assert.ok(generation.tool.executables?.some(e=>e.name==='ffmpeg'&&e.sha256));
  const out=path.join(dir,'影片.mp4');fs.writeFileSync(out,'video');final.recordFinalArtifact(dir,{generation,path:out,stage:'encode:mp4',technical:{status:'passed'}});
  const file=path.join(dir,'.wka/final-delivery.json'),data=JSON.parse(fs.readFileSync(file));data.artifacts[0].tool.executables[0].sha256='changed';fs.writeFileSync(file,JSON.stringify(data));
  const item=final.finalDeliveryReport(dir).items[0];assert.equal(item.freshness,'unknown');assert.match(item.reasons.join(' '),/工具/);
});

test('A10 macOS cannot treat a failed process probe as an exited editor',t=>{
  if(process.platform!=='darwin')return;
  const dir=fixture(t);draftArtifact(dir);const previous=process.env.PATH;
  try {
    process.env.PATH='/wka-nonexistent-path';const revision=final.finalDeliveryReport(dir).reviewSets[8].deliveryRevision;
    assert.throws(()=>final.prepareFinalApproval(dir,{id:'unknown-process',step:8,revision,source:'用户',note:'通过'}),/无法核实剪映进程/);
  }finally{process.env.PATH=previous;}
});

test('A1 conflicting aspect decisions retain evidenced files without making them required/current',t=>{
  const dir=fixture(t),draft=draftArtifact(dir),file=path.join(dir,'.wka/decisions.json'),decisions=JSON.parse(fs.readFileSync(file));
  decisions.aspects.value=['1:1'];fs.writeFileSync(file,JSON.stringify(decisions));
  const report=final.finalDeliveryReport(dir);assert.equal(report.status,'needs-verification');assert.equal(report.ok,false);
  assert.ok(report.candidates?.some(i=>i.path===draft&&i.link&&i.section==='历史/待核实版本'));
});

function engineRecheckFixture(t) {
  const dir=fixture(t),file=path.join(dir,'影片.mp4');
  const generation=final.captureFinalGeneration(dir,{slot:'16:9/video/mp4/clean',fontFiles:[path.join(dir,'film.json')]});
  fs.writeFileSync(file,'generated video');
  const artifact=final.recordFinalArtifact(dir,{generation,path:file,stage:'encode:mp4',technical:{status:'passed'}});
  const ledgerFile=path.join(dir,'.wka/final-delivery.json'),data=JSON.parse(fs.readFileSync(ledgerFile));
  const stored=data.artifacts.find(a=>a.id===artifact.id);
  const find=v=>{if(!v||typeof v!=='object')return null;if(typeof v.path==='string'&&v.snapshot?.kind==='file'&&v.path.includes(`${path.sep}engine${path.sep}`))return v;for(const child of Object.values(v)){const hit=find(child);if(hit)return hit;}return null;};
  const engineFile=find(stored.dependencies.groups);
  engineFile.snapshot.entries[0].sha256='f'.repeat(64);engineFile.snapshot.sha256='e'.repeat(64);
  fs.writeFileSync(ledgerFile,JSON.stringify(data));
  return {dir,file,artifact};
}

test('B1 engine-only change is listed read-only, then accepted by an explicit note without rewriting old evidence',t=>{
  const {dir,artifact}=engineRecheckFixture(t),video=()=>final.finalDeliveryReport(dir).items.find(i=>i.kind==='video');
  assert.equal(video().freshness,'changed');
  const before=fs.readFileSync(path.join(dir,'.wka/final-delivery.json'),'utf8');
  const listed=final.recheckEngineChange(dir);
  assert.equal(listed.accepted,false);assert.equal(listed.items.length,1);assert.equal(listed.items[0].eligible,true);
  assert.ok(listed.items[0].files.length>=1&&listed.items[0].files.every(f=>f.startsWith('引擎/')));
  assert.equal(fs.readFileSync(path.join(dir,'.wka/final-delivery.json'),'utf8'),before,'只列出时不能写账本');
  assert.throws(()=>final.recheckEngineChange(dir,{accept:true}),/复核说明/);
  const done=final.recheckEngineChange(dir,{accept:true,note:'核对变动文件与本片无关'});
  assert.equal(done.added.length,1);
  const data=JSON.parse(fs.readFileSync(path.join(dir,'.wka/final-delivery.json'),'utf8'));
  assert.equal(data.artifacts.length,2);assert.deepEqual(data.artifacts[0],JSON.parse(before).artifacts[0],'旧证据保持原样');
  const entry=data.artifacts[1];assert.equal(entry.provenance,'engine-recheck');assert.equal(entry.recheck.of,artifact.id);assert.equal(entry.recheck.note,'核对变动文件与本片无关');
  assert.deepEqual(entry.snapshot,artifact.snapshot);
  assert.equal(video().freshness,'current');assert.equal(video().acceptance,'pending');
  assert.deepEqual(final.recheckEngineChange(dir).items,[]);
});

test('B2 recheck refuses when film inputs changed or the output file changed',t=>{
  let fx=engineRecheckFixture(t);
  fs.appendFileSync(path.join(fx.dir,'shots/s01.js'),'// 改了画面');
  let item=final.recheckEngineChange(fx.dir).items[0];assert.equal(item.eligible,false);assert.match(item.reason,/不只是引擎/);
  assert.deepEqual(final.recheckEngineChange(fx.dir,{accept:true,note:'x'}).added,[]);
  fx=engineRecheckFixture(t);fs.appendFileSync(fx.file,'tampered');
  item=final.recheckEngineChange(fx.dir).items[0];assert.equal(item.eligible,false);assert.match(item.reason,/生成后变化/);
});
