import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeWorkbenchUI } from '../../plugin/engine/core/workbench-ui.mjs';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { captureWorkbench, workbenchFile, addWorkbenchNote, registerWorkbenchArtifact, checkWorkbenchArtifact, recordWorkbenchRepair, resolveWorkbenchNote, decideWorkbenchStage } from '../../plugin/engine/core/workbench.mjs';

function fixture(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-archive-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir; }
function write(dir,file,value){const dest=path.join(dir,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,typeof value==='string'?value:JSON.stringify(value));}
function contents(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>[e.name,e.isDirectory()?contents(path.join(dir,e.name)):fs.readFileSync(path.join(dir,e.name)).toString('base64')]);}

test('新项目工作台八道工序，方案简报与分镜稿归属准确，没有旧固定产物门槛',t=>{
  const dir=fixture(t);initializeProduction(dir);write(dir,'brief.md','方案简报');write(dir,'story.md','剧本');write(dir,'storyboard.md','分镜稿');
  write(dir,'stills/s01-0.png','process image');write(dir,'review/局部小样/s01.mp4','process clip');
  const view=captureWorkbench(dir);assert.equal(view.readonly,false);assert.equal(view.stages.length,8);
  assert.equal(view.stages.find(s=>s.step===2).items.find(i=>i.relativePath==='brief.md').label,'方案简报');
  assert.equal(view.stages.find(s=>s.step===4).items.find(i=>i.relativePath==='storyboard.md').label,'分镜稿');
  assert.ok(view.stages.flatMap(s=>s.items).filter(i=>/stills|局部小样/.test(i.relativePath||'')).every(i=>!i.required));
  assert.equal(view.stages.flatMap(s=>s.items).some(i=>/visual-direction|人声来源|接触表|动态分镜|subtitles/.test(i.relativePath||'')&&i.required),false);
});

test('未接入过工作台的旧项目可只读预览现存文件，重复打开不会写入账本或锁',t=>{
  const dir=fixture(t);write(dir,'brief.md','原简报');write(dir,'.wka/state.json',{flow:5,step:5,history:[{step:5,label:'原分镜',note:'历史通过'}]});
  const before=contents(dir),view=captureWorkbench(dir);assert.equal(view.readonly,true);assert.match(view.flowLabel,/历史/);
  assert.equal(view.stages.some(s=>s.gate),false);
  assert.equal(view.stages.find(s=>s.step===5).decisions[0].note,'历史通过');
  const brief=view.stages.flatMap(s=>s.items).find(i=>i.relativePath==='brief.md');assert.ok(brief?.current);
  assert.equal(fs.readFileSync(workbenchFile(dir,brief.id,brief.current.id).file,'utf8'),'原简报');
  captureWorkbench(dir);assert.deepEqual(contents(dir),before);
});

test('已有旧快照、批注与原工序标签保留，缺失原文件仍可查看已有快照',t=>{
  const dir=fixture(t),bytes='已审阅原版',sha=crypto.createHash('sha256').update(bytes).digest('hex');
  write(dir,'.wka/state.json',{flow:5,step:13,history:[{step:13,label:'旧终审',note:'原批准'}]});
  write(dir,'.wka/workbench/objects/'+sha,bytes);
  write(dir,'.wka/workbench.json',{version:1,registrations:[],artifacts:[{id:'old-artifact',step:13,label:'旧成片',kind:'text',path:path.join(dir,'missing.md'),relativePath:'missing.md',required:true,versions:[{id:'old-version',number:1,snapshot:{kind:'file',entries:[{path:'missing.md',sha256:sha,size:Buffer.byteLength(bytes)}],digest:sha},context:{step:13,shots:[]}}]}],notes:[{id:'old-note',artifactId:'old-artifact',versionId:'old-version',text:'原意见',anchor:{type:'general'},resolved:false}],checks:[],decisions:[{step:13,decision:'approved',note:'原签批'}]});
  const before=contents(dir),view=captureWorkbench(dir),stage=view.stages.find(s=>s.step===13);
  assert.equal(stage.label,'旧终审');assert.ok(stage.decisions.some(d=>d.note==='原签批'));assert.ok(stage.decisions.some(d=>d.note==='原批准'));assert.equal(view.notes[0].text,'原意见');
  assert.equal(fs.readFileSync(workbenchFile(dir,'old-artifact','old-version').file,'utf8'),bytes);
  assert.deepEqual(contents(dir),before);
});

test('旧项目全部工作台写入口被拒绝且原目录不变',async t=>{
  const dir=fixture(t);write(dir,'brief.md','原简报');const before=contents(dir);
  for(const run of [()=>registerWorkbenchArtifact(dir,{file:'brief.md',step:2}),()=>addWorkbenchNote(dir,{}),()=>checkWorkbenchArtifact(dir,{}),()=>recordWorkbenchRepair(dir,{}),()=>resolveWorkbenchNote(dir,{}),()=>writeWorkbenchUI(dir,{key:'layout',expected:0,value:{}})]){
    assert.throws(run,{code:'WKA_LEGACY_READONLY'});assert.deepEqual(contents(dir),before);
  }
  await assert.rejects(()=>decideWorkbenchStage(dir,{},()=>assert.fail('不得调用签批')),{code:'WKA_LEGACY_READONLY'});
  assert.deepEqual(contents(dir),before);
});

test('历史档案的底层任务入口同样拒绝写入，恢复查询不返回续作指令',async t=>{
 const {lockProduction,rememberArtifacts,runStage,recoveryStatus}=await import('../../plugin/engine/core/operations.mjs');
 const dir=fixture(t);write(dir,'brief.md','旧片');const before=contents(dir);
 const {initProject}=await import('../../plugin/engine/core/project.mjs');assert.throws(()=>initProject(dir),{code:'WKA_LEGACY_READONLY'});
 assert.throws(()=>lockProduction(dir),{code:'WKA_LEGACY_READONLY'});
 assert.throws(()=>rememberArtifacts(dir,{}),{code:'WKA_LEGACY_READONLY'});
 await assert.rejects(()=>runStage(dir,{stage:'test',run:()=>assert.fail('不得执行')}),{code:'WKA_LEGACY_READONLY'});
 assert.equal(recoveryStatus(dir).readonly,true);assert.deepEqual(contents(dir),before);
});
