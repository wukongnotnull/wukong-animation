#!/usr/bin/env node
// 可独立随发布包分发；只依赖 Node 标准库，不修改 Agent 通用配置。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const RECEIPT='.wukong-install.json';
const MARKER='wukong-animation-install-v1';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
export const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const exists=p=>{try{fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
export function filesAt(root,prefix='') {
 return fs.readdirSync(path.join(root,prefix),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(e=>{
  const rel=prefix+e.name,stat=fs.lstatSync(path.join(root,rel));
  if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))fail(4,`不允许链接或特殊文件：${rel}`);
  return stat.isDirectory()?filesAt(root,rel+'/'):[rel];
 });
}
export function validateBundle(root) {
 try {
  const m=read(path.join(root,'bundle.json'));
  if(m.schemaVersion!==1||m.entry!=='SKILL.md'||!/^\d+\.\d+\.\d+$/.test(m.pluginVersion)||!Array.isArray(m.files))fail(4,'无效 bundle.json');
  const paths=m.files.map(f=>f.path);
  for(const p of paths)if(!p||p.includes('\\')||p.split('/').some(s=>!s||s==='..'||s==='.')||path.isAbsolute(p)||p==='bundle.json'||p===RECEIPT)fail(4,'非法包路径');
  const actual=filesAt(root).filter(p=>p!=='bundle.json');
  if(new Set(paths).size!==paths.length||JSON.stringify([...paths].sort())!==JSON.stringify([...actual].sort()))fail(4,'包文件清单不完整');
  for(const f of m.files)if(sha(path.join(root,f.path))!==f.sha256)fail(4,`包摘要不符：${f.path}`);
  for(const p of ['SKILL.md','engine/bin/wka.mjs','engine/package.json','catalog.json','skills/director/INSTRUCTIONS.md'])if(!paths.includes(p))fail(4,`缺少资源 ${p}`);
  return m;
 }catch(e){if(e.code===4)throw e;fail(4,`无效技能包：${e.message}`);}
}
export function loadProfiles() {
 return read(fs.existsSync(path.join(HERE,'agents.json'))?path.join(HERE,'agents.json'):path.join(HERE,'../distribution/agents.json'));
}
function safeParents(target) {
 for(let p=target;;p=path.dirname(p)){
  if(exists(p)&&fs.lstatSync(p).isSymbolicLink())fail(3,`路径不能经过链接：${p}`);
  if(path.dirname(p)===p)break;
 }
}
function installed(target) {
 if(!exists(target))return {state:'missing'};
 try{
  if(fs.lstatSync(target).isSymbolicLink())fail(3,'目标是链接');
  const r=read(path.join(target,RECEIPT));
  if(r.marker!==MARKER||r.schemaVersion!==1||r.target!==target||!Array.isArray(r.files)||!Array.isArray(r.agents)||!r.agents.length)fail(3,'安装收据不属于此目标');
  const actual=filesAt(target).filter(f=>f!==RECEIPT).sort(),expected=r.files.map(f=>f.path).sort();
  if(expected.some(p=>path.isAbsolute(p)||p.split('/').includes('..'))||JSON.stringify(actual)!==JSON.stringify(expected))return {state:'modified',receipt:r};
  for(const f of r.files)if(sha(path.join(target,f.path))!==f.sha256)return {state:'modified',receipt:r};
  return {state:'current',receipt:r};
 }catch(e){return {state:'conflict',reason:e.message};}
}
function versions(a,b){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return Math.sign(x[i]-y[i]);return 0;}
// 回滚事务只能处理具有本工具收据/标记的目录，不删除来源不明的同名残留。
function recover(target,tx) {
 if(!exists(tx.journal))return;
 const j=read(tx.journal);
 if(j.marker!==MARKER||j.target!==target)fail(5,'未知事务，停止恢复');
 if(exists(tx.backup)){
  if(installed(tx.backup).state==='conflict') {
   // 收据内 target 仍为正式路径；单独验证备份时按原目标检查。
   const r=read(path.join(tx.backup,RECEIPT));if(r.marker!==MARKER||r.target!==target)fail(5,'备份无法识别');
  }
  if(exists(target)){
   if(installed(target).state!=='current')fail(5,'新目录已修改，保留事务等待人工处理');
   fs.rmSync(target,{recursive:true});
  }
  fs.renameSync(tx.backup,target);
 }
 if(exists(tx.stage)){
  fs.rmSync(tx.stage,{recursive:true});
 }
 fs.unlinkSync(tx.journal);
}
export function operate(action,opt={},context={}) {
 const profiles=context.profiles||loadProfiles();
 if(action==='list')return {code:0,agents:profiles.agents};
 if(!['install','upgrade','status','uninstall'].includes(action))fail(2,'命令应为 list/install/status/upgrade/uninstall');
 const base=profiles.agents.find(p=>p.familyId===opt.agent);if(!base)fail(2,'必须指定有效 --agent；用 list 查看');
 if(base.qualification!=='contract-supported')fail(2,base.limitations);
 if(base.channel==='native')return {code:0,state:'unsupported',changed:false,agent:base.familyId,message:'使用原生 marketplace 安装渠道；未执行目录复制'};
 if(!base.scopes.includes(opt.scope))fail(2,'必须选择受支持的 --scope project|global');
 if(opt.variant&&!Object.hasOwn(base.variants,opt.variant))fail(2,'未知 variant');
 if(Object.keys(base.variants).length&&!opt.variant)fail(2,'此工具需显式 --variant：'+Object.keys(base.variants).join(', '));
 const profile={...base,...base.variants[opt.variant]};
 const home=context.home||os.homedir();
 if(opt.scope==='project'&&(!opt.project||!path.isAbsolute(opt.project)||!fs.statSync(opt.project).isDirectory()))fail(2,'--project 必须是已存在的绝对目录');
 const root=fs.realpathSync(opt.scope==='project'?opt.project:home);
 const rel=opt.scope==='project'?profile.projectPath:profile.globalPath?.replace(/^~\//,'');
 if(!rel||path.isAbsolute(rel)||rel.split(/[\\/]/).includes('..'))fail(2,'profile 路径无效');
 const target=path.resolve(root,rel,'wukong-animation');safeParents(target);
 const pending=exists(path.join(path.dirname(target),'.wukong-animation.transaction.json'));
 const before=installed(target),result={code:0,action,agent:base.familyId,target,scope:opt.scope,state:before.state,version:before.receipt?.pluginVersion||null,changed:false};
 if(action==='status')return {...result,pendingTransaction:pending,resources:before.state==='current'?'verified':'unverified',owners:before.receipt?.agents||[],reason:before.reason};
 if(['modified','conflict'].includes(before.state))fail(3,`目标 ${before.state}，请备份/迁移用户改动后重试：${target}`);
 const source=path.resolve(opt.bundle||path.join(HERE,'wukong-animation'));
 const manifest=action==='uninstall'?null:validateBundle(source);
 if(action==='upgrade'&&before.state==='missing'&&!pending)fail(3,'未安装，先执行 install');
 if(manifest&&before.receipt&&versions(manifest.pluginVersion,before.receipt.pluginVersion)<0)fail(3,'拒绝自动降级');
 if(manifest&&before.receipt&&manifest.pluginVersion===before.receipt.pluginVersion&&manifest.sourceCommit!==before.receipt.sourceCommit)fail(3,'相同版本来源不同，拒绝覆盖');
 const owner=base.familyId+(opt.variant?':'+opt.variant:'');
 const owners=new Set(before.receipt?.agents||[]);
 if(action==='uninstall')owners.delete(owner);else owners.add(owner);
 if(action==='uninstall'&&!pending&&(!before.receipt||!before.receipt.agents.includes(owner)))return result;
 if(opt.dryRun)return {...result,version:manifest?.pluginVersion||result.version,dryRun:true,plannedAction:action,owners:[...owners]};
 const parent=path.dirname(target);fs.mkdirSync(parent,{recursive:true});
 const tx={lock:path.join(parent,'.wukong-animation.lock'),journal:path.join(parent,'.wukong-animation.transaction.json'),stage:path.join(parent,'.wukong-animation.stage'),backup:path.join(parent,'.wukong-animation.backup')};
 if(exists(tx.lock)){
  const lock=read(tx.lock);if(lock.marker!==MARKER||lock.target!==target||!Number.isInteger(lock.pid)||lock.pid<=0)fail(5,'未知安装锁');
  let alive=true;try{process.kill(lock.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
  if(alive)fail(5,'另一安装事务正在运行');
  recover(target,tx);fs.unlinkSync(tx.lock);
 }
 let fd;try{fd=fs.openSync(tx.lock,'wx');fs.writeFileSync(fd,JSON.stringify({marker:MARKER,target,pid:process.pid}));fs.closeSync(fd);fd=null;}catch(e){fail(5,`无法取得安装锁：${e.message}`);}
 try{
  recover(target,tx);
  // 锁内重查，防止两个进程在预检后交错覆盖。
  const current=installed(target);
  if(JSON.stringify(current)!==JSON.stringify(before))fail(3,'目标已变化，请重新执行');
  if(exists(tx.stage)||exists(tx.backup))fail(5,'存在未知暂存/备份，保留待检查');
  if(action!=='uninstall'){
   if(before.receipt&&before.receipt.pluginVersion===manifest.pluginVersion){
    const expected=before.receipt.files.filter(f=>f.path!=='bundle.json');
    if(JSON.stringify(expected)!==JSON.stringify(manifest.files))fail(3,'相同版本内容不同，拒绝覆盖');
    if(JSON.stringify([...owners].sort())===JSON.stringify(before.receipt.agents))return result;
   }
   write(tx.journal,{marker:MARKER,target});
   fs.cpSync(source,tx.stage,{recursive:true});validateBundle(tx.stage);
  }else {write(tx.journal,{marker:MARKER,target});if(owners.size)fs.cpSync(target,tx.stage,{recursive:true});}
  if(exists(tx.stage)){
   const receipt={marker:MARKER,schemaVersion:1,installerVersion:1,target,scope:opt.scope,agents:[...owners].sort(),pluginVersion:manifest?.pluginVersion||before.receipt.pluginVersion,sourceCommit:manifest?.sourceCommit||before.receipt.sourceCommit,files:filesAt(tx.stage).filter(f=>f!==RECEIPT).map(p=>({path:p,sha256:sha(path.join(tx.stage,p))}))};
   write(path.join(tx.stage,RECEIPT),receipt);
  }
  write(tx.journal,{marker:MARKER,target});
  if(exists(target))fs.renameSync(target,tx.backup);
  if(exists(tx.stage))fs.renameSync(tx.stage,target);
  if(exists(tx.backup))fs.rmSync(tx.backup,{recursive:true});
  fs.unlinkSync(tx.journal);
  return {...result,state:owners.size?'current':'missing',version:manifest?.pluginVersion||result.version,changed:true,owners:[...owners]};
 }catch(e){
  try{recover(target,tx);}catch(recovery){fail(5,`${e.message}；恢复停止：${recovery.message}`);}
  // 在建立事务前复制/校验失败，清理只含已校验来源的暂存目录。

  throw e;
 }finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);fs.rmSync(tx.lock,{force:true});}
}
function parse(argv){const [action,...args]=argv,opt={};for(let i=0;i<args.length;i++){
 const a=args[i];if(['--json','--dry-run'].includes(a)){opt[a==='--json'?'json':'dryRun']=true;continue;}
 const key={'--agent':'agent','--variant':'variant','--scope':'scope','--project':'project','--bundle':'bundle'}[a];
 if(!key||!args[i+1]||args[i+1].startsWith('--'))fail(2,'未知或缺值参数 '+a);opt[key]=args[++i];
 }return {action,opt};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let json=process.argv.includes('--json');try{
  const {action,opt}=parse(process.argv.slice(2));
  if(!opt.json&&['install','upgrade','uninstall'].includes(action))process.stdout.write(JSON.stringify(operate(action,{...opt,dryRun:true}),null,2)+'\n');
  const result=operate(action,opt);process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }catch(e){const code=typeof e.code==='number'?e.code:5;process[json?'stdout':'stderr'].write(JSON.stringify({code,changed:false,error:e.message})+'\n');process.exitCode=code;}
}
