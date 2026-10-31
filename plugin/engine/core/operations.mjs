// 阶段执行与恢复；实现依据已批准 FR-6。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { atomicJson, readJson, digest, fileDigest, fileEvidence, treeEvidence } from './evidence.mjs';
import { fileVersion } from './file-hash.mjs';
import { ENGINE_ROOT } from './paths.mjs';
import { assertCompatibleProgress } from './state.mjs';

const ledgerFile=dir=>path.join(path.resolve(dir),'.cache/operations.json');
const keyOf=({stage,aspect,proxy})=>`${aspect}|${proxy?'proxy':'full'}|${stage}`;
const load=dir=>{
  const data=readJson(ledgerFile(dir));
  return data?.version===1&&data.stages&&typeof data.stages==='object'&&!Array.isArray(data.stages)?data:{version:1,stages:{},diagnostics:fs.existsSync(ledgerFile(dir))?['阶段记录损坏或版本不支持，未复用']:[]};
};
export const implementationState=()=>digest(treeEvidence(ENGINE_ROOT,(rel,ent)=>ent.isDirectory()&&['node_modules','.cache'].includes(ent.name)));
export function sourceState(dir) {
  // 摘要只在本次同步观察中共享；所有声明和树条目仍保留在原投影中。
  const versions=new Map(),hashes=new Map(),guards=[];
  const changed=file=>new Error(`来源在观察期间发生变化：${file}`);
  const observe=file=>{
    file=path.resolve(file);
    const current=fileVersion(file);
    if(versions.has(file)&&versions.get(file)!==current)throw changed(file);
    versions.set(file,current);
    return current;
  };
  const readDigest=file=>{
    file=path.resolve(file);observe(file);
    if(!hashes.has(file))hashes.set(file,fileDigest(file));
    return hashes.get(file);
  };
  const source=file=>observe(file)===null?null:fileEvidence(file,readDigest).sha256;
  const shape=(base,exclude)=>{
    if(!fs.existsSync(base))return null;
    const entries=[];
    const walk=dir=>{
      for(const ent of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
        const file=path.join(dir,ent.name),rel=path.relative(base,file);
        if(exclude(rel,ent))continue;
        if(ent.isDirectory()){entries.push([rel,'directory']);walk(file);}
        else if(ent.isFile())entries.push([rel,'file']);
      }
    };
    walk(base);return JSON.stringify(entries);
  };
  const tree=(base,exclude=()=>false)=>{
    const before=shape(base,exclude);
    guards.push(()=>{if(shape(base,exclude)!==before)throw changed(base);});
    return treeEvidence(base,exclude,readDigest);
  };
  const roots=['film.json','brief.md','story.md','storyboard.md','sync-points.json','subtitle-layout.json','review-notes.json','.wka/decisions.json'];
  const data=roots.map(rel=>[rel,source(path.join(dir,rel))]);
  const film=readJson(path.join(dir,'film.json'),{});
  const references=[...(film.scripts||[]),...(film.shots||[]).map(s=>s.file),...(film.audio?.tracks||[]).map(t=>t.file),...(film.audio?.voices||[]).map(t=>t.file)].filter(Boolean);
  for(const rel of references)data.push([rel,source(path.resolve(dir,rel))]);
  data.push(['shots',tree(path.join(dir,'shots'))],['audio',tree(path.join(dir,'audio'),(rel,ent)=>ent.isDirectory()&&ent.name==='generated')]);
  const subtitleNames=()=>fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>/^subtitles.*\.(srt|json)$/.test(f)):[];
  const subtitles=subtitleNames();
  guards.push(()=>{if(JSON.stringify(subtitleNames())!==JSON.stringify(subtitles))throw changed(dir);});
  for(const file of subtitles)data.push([file,fileEvidence(path.join(dir,file),readDigest).sha256]);
  // 检查新增/删除条目和缺失引用；排除目录及无关缓存写入不触发目录 mtime 误报。
  for(const guard of guards)guard();
  for(const file of versions.keys())observe(file);
  return digest(data);
}
const capture=file=>fs.statSync(file).isDirectory()?{file:path.resolve(file),kind:'directory',entries:treeEvidence(file)}:{...fileEvidence(file),kind:'file'};
export function outputsMatch(outputs) {
  try {return outputs.length>0&&outputs.every(old=>digest(capture(old.file))===digest(old));}catch{return false;}
}
export function rememberArtifacts(dir,{stage,aspect,proxy=false,signature,value,outputs}) {
  assertCompatibleProgress(dir);
  const data=load(dir),key=keyOf({stage,aspect,proxy});
  data.stages[key]={id:crypto.randomUUID(),stage,aspect,proxy,signature,implementation:implementationState(),sourceState:sourceState(dir),status:'completed',startedAt:new Date().toISOString(),completedAt:new Date().toISOString(),value,outputs:outputs.map(capture)};
  atomicJson(ledgerFile(dir),data); return data.stages[key];
}
export async function runStage(dir,{stage,aspect,proxy=false,signature,force=false,log=console.log,run,validate=()=>true,onReuse=()=>{}}) {
  assertCompatibleProgress(dir);
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
  assertCompatibleProgress(dir);
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
  assertCompatibleProgress(dir);
  const data=load(dir);
  const source=sourceState(dir),implementation=implementationState();
  const stages=Object.values(data.stages).map(s=>({...s,status:s.status==='running'?(s.host!==os.hostname()?'needs-review':alive(s.pid)?'running':'interrupted'):s.status==='completed'&&!outputsMatch(s.outputs)?(s.stage==='draft-export'?'user-modified':'stale'):s.status==='completed'&&(s.sourceState!==source||s.implementation!==implementation)?'stale':s.status}));
  const pending=readJson(path.join(dir,'.wka/pending-approval.json'));
  return {version:1,stages,diagnostics:data.diagnostics||[],pendingApproval:pending?.status!=='completed'?pending:null,archive:pending?.status==='completed'?pending:null,next:pending&&pending.status!=='completed'?'核对待存档签批与当前产物后重试原 signoff 命令':pending?.git==='not-confirmed'?'批准已存档；Git 提交未确认，可沿用原 approval-id 重试存档':'按原命令重跑；完整产物复用，缺失阶段补做，待审节点仍需用户批准'};
}
