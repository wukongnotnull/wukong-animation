// 阶段执行与恢复；实现依据已批准 FR-6。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { atomicJson, readJson, digest, fileEvidence, treeEvidence } from './evidence.mjs';
import { ENGINE_ROOT } from './paths.mjs';

const ledgerFile=dir=>path.join(path.resolve(dir),'.cache/operations.json');
const keyOf=({stage,aspect,proxy})=>`${aspect}|${proxy?'proxy':'full'}|${stage}`;
const load=dir=>{
  const data=readJson(ledgerFile(dir));
  return data?.version===1&&data.stages&&typeof data.stages==='object'&&!Array.isArray(data.stages)?data:{version:1,stages:{},diagnostics:fs.existsSync(ledgerFile(dir))?['阶段记录损坏或版本不支持，未复用']:[]};
};
export const implementationState=()=>digest(treeEvidence(ENGINE_ROOT,(rel,ent)=>ent.isDirectory()&&['node_modules','.cache'].includes(ent.name)));
export function sourceState(dir) {
  const roots=['film.json','brief.md','story.md','storyboard.md','sync-points.json','subtitle-layout.json','review-notes.json','.wka/decisions.json'];
  const data=roots.map(rel=>[rel,fs.existsSync(path.join(dir,rel))?fileEvidence(path.join(dir,rel)).sha256:null]);
  const film=readJson(path.join(dir,'film.json'),{});
  const references=[...(film.scripts||[]),...(film.shots||[]).map(s=>s.file),...(film.audio?.tracks||[]).map(t=>t.file),...(film.audio?.voices||[]).map(t=>t.file)].filter(Boolean);
  for(const rel of references) data.push([rel,fs.existsSync(path.resolve(dir,rel))?fileEvidence(path.resolve(dir,rel)).sha256:null]);
  data.push(['shots',treeEvidence(path.join(dir,'shots'))],['audio',treeEvidence(path.join(dir,'audio'),(rel,ent)=>ent.isDirectory()&&ent.name==='generated')]);
  if(fs.existsSync(dir)) for(const f of fs.readdirSync(dir).filter(f=>/^subtitles.*\.(srt|json)$/.test(f))) data.push([f,fileEvidence(path.join(dir,f)).sha256]);
  return digest(data);
}
const capture=file=>fs.statSync(file).isDirectory()?{file:path.resolve(file),kind:'directory',entries:treeEvidence(file)}:{...fileEvidence(file),kind:'file'};
export function outputsMatch(outputs) {
  try {return outputs.length>0&&outputs.every(old=>digest(capture(old.file))===digest(old));}catch{return false;}
}
export function rememberArtifacts(dir,{stage,aspect,proxy=false,signature,value,outputs}) {
  const data=load(dir),key=keyOf({stage,aspect,proxy});
  data.stages[key]={id:crypto.randomUUID(),stage,aspect,proxy,signature,implementation:implementationState(),sourceState:sourceState(dir),status:'completed',startedAt:new Date().toISOString(),completedAt:new Date().toISOString(),value,outputs:outputs.map(capture)};
  atomicJson(ledgerFile(dir),data); return data.stages[key];
}
export async function runStage(dir,{stage,aspect,proxy=false,signature,force=false,log=console.log,run,validate=()=>true,onReuse=()=>{}}) {
  const key=keyOf({stage,aspect,proxy}),data=load(dir),old=data.stages[key];
  const label=`[${aspect} ${proxy?'小样':'高清'} · ${stage}]`;
  if(!force&&signature&&old?.signature===signature&&old.implementation===implementationState()&&old.status==='completed'&&outputsMatch(old.outputs)&&await validate(old.value)){
    data.stages[key]={...old,sourceState:sourceState(dir),checkedAt:new Date().toISOString()};atomicJson(ledgerFile(dir),data);
    log(`${label} 复用完成产物`);onReuse();return old.value;
  }
  const entry={id:crypto.randomUUID(),stage,aspect,proxy,signature,status:'running',command:readJson(path.join(dir,'.cache/active-command.json'))?.argv||null,pid:process.pid,host:os.hostname(),startedAt:new Date().toISOString()};
  data.stages[key]=entry;atomicJson(ledgerFile(dir),data);log(`${label} 开始`);
  try {
    const {value,outputs}=await run(entry);
    if(!await validate(value)) throw new Error('阶段产物校验未通过');
    const next=load(dir);next.stages[key]={...entry,implementation:implementationState(),sourceState:sourceState(dir),status:'completed',completedAt:new Date().toISOString(),value,outputs:outputs.map(capture)};
    atomicJson(ledgerFile(dir),next);log(`${label} 完成`);return value;
  }catch(e){
    const next=load(dir);next.stages[key]={...entry,status:'failed',error:e.message,endedAt:new Date().toISOString()};atomicJson(ledgerFile(dir),next);
    log(`${label} 失败：${e.message}`);throw e;
  }
}
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
export function lockProduction(dir) {
  const file=path.join(path.resolve(dir),'.cache/operation.lock');fs.mkdirSync(path.dirname(file),{recursive:true});
  for(let n=0;n<2;n++){
    try{
      const fd=fs.openSync(file,'wx'),token=crypto.randomUUID();fs.writeFileSync(fd,JSON.stringify({pid:process.pid,host:os.hostname(),token}));fs.closeSync(fd);
      return ()=>{if(readJson(file)?.token===token) fs.rmSync(file,{force:true});};
    }catch(e){
      if(e.code!=='EEXIST') throw e;
      const old=readJson(file);
      if(!old||old.host!==os.hostname()||alive(old.pid)) throw new Error(`工程正在写入或锁所有者无法核实，请稍后检查：${file}`);
      fs.rmSync(file,{force:true});
    }
  }
  throw new Error('工程忙，无法取得写入锁');
}
export function recoveryStatus(dir) {
  const data=load(dir);
  const source=sourceState(dir),implementation=implementationState();
  const stages=Object.values(data.stages).map(s=>({...s,status:s.status==='running'?(s.host!==os.hostname()?'needs-review':alive(s.pid)?'running':'interrupted'):s.status==='completed'&&!outputsMatch(s.outputs)?(s.stage==='draft-export'?'user-modified':'stale'):s.status==='completed'&&(s.sourceState!==source||s.implementation!==implementation)?'stale':s.status}));
  const pending=readJson(path.join(dir,'.wka/pending-approval.json'));
  return {version:1,stages,diagnostics:data.diagnostics||[],pendingApproval:pending?.status!=='completed'?pending:null,archive:pending?.status==='completed'?pending:null,next:pending&&pending.status!=='completed'?'核对待存档签批与当前产物后重试原 signoff 命令':pending?.git==='not-confirmed'?'批准已存档；Git 提交未确认，可沿用原 approval-id 重试存档':'按原命令重跑；完整产物复用，缺失阶段补做，待审节点仍需用户批准'};
}
