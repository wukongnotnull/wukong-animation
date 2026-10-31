// 最终交付：查询不执行制作代码、不迁移流程、不刷新阶段缓存。
import fs from 'node:fs';
import path from 'node:path';
import { digest, atomicJson, treeEvidence, fileDigest } from './evidence.mjs';
import { loadFilm } from './job.mjs';
import { fileLink, readDecisions, decisionConflicts } from './delivery.mjs';
import { subtitleSettings, subtitleOutputs } from './subtitles.mjs';
import { validate } from './validate.mjs';
import { ENGINE_ROOT } from './paths.mjs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { migrateProgress, assertCompatibleProgress } from './state.mjs';
import { outputsMatch } from './operations.mjs';
import { qcReview, readReviewNotes, isSoftFinding } from './review-evidence.mjs';
import { qcConfig } from './qc.mjs';
import { usedCueNames, pickCues } from './cues.mjs';
import { spawnSync } from 'node:child_process';

const ledgerPath=dir=>path.join(path.resolve(dir),'.wka/final-delivery.json');
const latestArtifact=(data,slot)=>data.artifacts.filter(a=>a.slot===slot).reduce((latest,a)=>!latest||Date.parse(a.observedAt||a.generatedAt)>=Date.parse(latest.observedAt||latest.generatedAt)?a:latest,null);
function json(file,fallback) {
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(e){if(e.code==='ENOENT')return fallback;throw new Error(`${file}：${e.message}`);}
}
function ledger(dir) {
  const value=json(ledgerPath(dir),{version:1,contracts:[],artifacts:[],approvals:[]});
  const errors=validate('final-delivery',value);
  if(!errors.length)for(const a of value.artifacts)if(!Number.isFinite(Date.parse(a.observedAt||a.generatedAt)))errors.push(`产物时间无法核实：${a.id}`);
  if(errors.length)throw new Error(`${ledgerPath(dir)}：交付账本结构损坏：${errors.join('；')}`);
  return value;
}

// 完整目录快照；不跟随链接、不猜测哪些 native 文件可忽略。
export function deliverySnapshot(file) {
  file=path.resolve(file);
  const scan=()=>{
    const entries=[];
    const walk=(name,rel)=>{
      const st=fs.lstatSync(name);
      if(st.isSymbolicLink()||(!st.isFile()&&!st.isDirectory()))throw new Error(`链接或特殊文件无法核实：${name}`);
      if(st.isDirectory())for(const child of fs.readdirSync(name).sort())walk(path.join(name,child),rel?rel+'/'+child:child);
      else entries.push({path:rel||path.basename(name),size:st.size,sha256:fileDigest(name)});
    };
    walk(file,'');
    if(!entries.length||!entries.some(e=>e.size))throw new Error(`文件或目录为空：${file}`);
    return {kind:fs.lstatSync(file).isDirectory()?'directory':'file',entries};
  };
  const first=scan(),second=scan();
  if(digest(first)!==digest(second))throw new Error(`扫描期间磁盘内容变化：${file}`);
  return {...first,sha256:digest(first)};
}

export function finalContract(dir,{aspect=null}={}) {
  dir=path.resolve(dir);
  const main=loadFilm(dir,{requireShots:false}),decisions=readDecisions(dir),errors=decisionConflicts(main,decisions);
  for(const k of ['delivery','aspects','subtitles'])if(decisions[k]?.status!=='confirmed')errors.push(`缺少明确制作决定：${k}`);
  const configured=[main.variant.aspect,...Object.keys(main.film.variants||{})];
  const all=decisions.aspects?.status==='confirmed'?decisions.aspects.value:configured;
  const selected=[...new Set(aspect&&aspect!=='all'?[aspect]:all)];
  if(aspect&&aspect!=='all'&&selected.some(a=>!configured.includes(a)||!all.includes(a)))throw new Error('请求画幅不在已确认及已配置范围内');
  const slots=[];
  for(const a of selected) {
    if(!configured.includes(a))continue;
    const ctx=loadFilm(dir,{requireShots:false,aspect:a}),settings=subtitleSettings(ctx.film,ctx.variant),names=subtitleOutputs(settings.mode,settings.bilingual);
    const formats=[...new Set((ctx.film.export?.formats||['mp4']).filter(f=>f!=='jianying'))];
    // 草稿命令/格式不能取消视频承诺；未声明视频格式时沿用既有 mp4 默认值。
    if(!formats.length)formats.push('mp4');
    const add=(kind,format,flavor,suffix)=>{
      const slot=[a,kind,format,...(flavor?[flavor]:[])].join('/');
      const ext=kind==='subtitle'?'srt':ctx.registry.exporters.get(format)?.ext;
      if(kind==='video'&&!ext)errors.push(`未注册的导出格式：${format}`);
      const file=kind==='draft'||!ext?null:path.join(dir,ctx.variant.exportName+suffix+'.'+ext);
      const projection={slot,name:ctx.variant.exportName,...(kind==='draft'?{title:ctx.variant.title}:{}),...(kind==='video'?{size:ctx.film.size,fps:ctx.film.fps}:{}),...(flavor==='burned'?{bilingual:settings.bilingual}:{})};
      const stage=kind==='draft'?'draft-export':kind==='subtitle'?'review:sidecar-'+(format==='zh'?'srt':'en'):`encode:${format}${suffix}`;
      slots.push({slot,aspect:a,kind,format,flavor:flavor||null,path:file,stage,projection,contractDigest:digest(projection)});
    };
    if(names.burned!==null)for(const f of formats)add('video',f,'burned',names.burned);
    if(names.clean!==null)for(const f of names.burned===null?formats:['mp4'])add('video',f,'clean',names.clean);
    if(names.srt!==null)add('subtitle','zh',null,names.srt);
    if(names.srtEn)add('subtitle','en',null,names.srtEn);
    if(decisions.delivery?.value==='video-and-draft')add('draft','jianying',null,'');
  }
  return {id:digest({slots:slots.map(s=>s.projection),decisions}),scope:aspect&&aspect!=='all'?aspect:'all',mainAspect:main.variant.aspect,decisions,slots,errors};
}

function observed(file) {
  if(!file)return {availability:'missing',snapshot:null,reasons:['尚无实际导出路径']};
  try{return {availability:'present',snapshot:deliverySnapshot(file),reasons:[]};}
  catch(e){return {availability:e.code==='ENOENT'?'missing':'unreadable',snapshot:null,reasons:[e.message]};}
}
function legacyPath(dir,slot) {
  const stages=Object.values(json(path.join(dir,'.cache/operations.json'),{stages:{}}).stages||{});
  const stage=stages.find(s=>s.stage===slot.stage&&s.aspect===slot.aspect&&!s.proxy&&s.status==='completed');
  const file=typeof stage?.value==='string'?stage.value:stage?.outputs?.[0]?.file;
  return typeof file==='string'?path.resolve(dir,file):null;
}

const sourceFile=file=>{
  try{return {path:path.resolve(file),snapshot:deliverySnapshot(file)};}
  catch(e){return {path:path.resolve(file),snapshot:null,error:e.code==='ENOENT'?'missing':e.message};}
};
const engineFiles=names=>names.map(name=>sourceFile(path.join(ENGINE_ROOT,name)));
const codeSource=file=>{
  const value=sourceFile(file);if(value.snapshot?.kind!=='directory')return value;
  const entries=value.snapshot.entries.filter(e=>!/(^|\/)__pycache__\//.test(e.path)&&!/(\.pyc|\.md)$/.test(e.path));
  return {...value,snapshot:{kind:'directory',entries,sha256:digest({kind:'directory',entries})}};
};
function executable(name) {
  for(const root of (process.env.PATH||'').split(path.delimiter))try {
    const candidate=path.resolve(root,name);fs.accessSync(candidate,fs.constants.X_OK);
    if(!fs.statSync(candidate).isFile())continue;
    const file=fs.realpathSync(candidate);return {name,path:file,sha256:fileDigest(file)};
  }catch{/* 继续寻找实际可执行文件 */}
  return {name,path:null,sha256:null};
}
function generationTools(slot) {
  const executables=slot.kind==='subtitle'?[]:[executable('ffmpeg'),...(slot.kind==='draft'?[executable('python3')]:[])],packages=[];
  if(slot.kind==='draft') {
    const result=spawnSync('python3',['-c','import json, importlib.util, importlib.metadata, pathlib; print(json.dumps({"version": importlib.metadata.version("pyJianYingDraft"), "root": str(pathlib.Path(importlib.util.find_spec("pyJianYingDraft").origin).parent)}))'],{encoding:'utf8'});
    try{const value=JSON.parse(result.stdout);packages.push({name:'pyJianYingDraft',version:value.version,source:codeSource(value.root)});}catch{packages.push({name:'pyJianYingDraft',version:null,source:null});}
  }
  return {node:process.version,platform:process.platform,arch:process.arch,executables,packages,pythonPath:slot.kind==='draft'?(process.env.PYTHONPATH||null):null};
}
const fontPaths=css=>[...String(css||'').matchAll(/url\((?:'([^']*)'|"([^"]*)"|([^)]*))\)/g)].map(m=>(m[1]||m[2]||m[3]).trim()).filter(u=>u.startsWith('file:')).map(u=>fileURLToPath(u));
export const finalFontFiles=(...styles)=>[...new Set(styles.flatMap(s=>fontPaths(s?.css||s?.fontCss)))];
export const finalFontUnknown=(...styles)=>styles.flatMap(s=>s?.report||s?.fontReport||[]).filter(r=>r.includes('不可用')).map(r=>'实际字体来源不足：'+r);

// 分组投影独立于全局 operations 签名；只观察声明输入，未知外部执行明确阻塞。
function dependencies(dir,slot,fontFiles=[]) {
  const ctx=loadFilm(dir,{requireShots:false,aspect:slot.aspect}),settings=subtitleSettings(ctx.film,ctx.variant),groups={},unknown=[];
  const sub=slot.kind==='subtitle',visual=!sub,caption=settings.mode!=='none'&&(slot.kind==='draft'||slot.flavor==='burned');
  const files=names=>names.map(f=>sourceFile(path.resolve(dir,f)));
  if(visual) {
    const scripts=[...ctx.shots.map(s=>s.path),...ctx.styleScripts,...ctx.filmScripts];
    groups.picture={files:files(scripts),assets:[sourceFile(path.join(ctx.style.dir,'assets'))].filter(x=>x.snapshot),config:{size:ctx.film.size,fps:ctx.film.fps,seed:ctx.film.seed,title:ctx.film.title,shots:ctx.shots.map(({id,duration})=>({id,duration})),cues:pickCues(ctx.film.cues||{},scripts),style:ctx.film.style}};
    const names=usedCueNames(scripts.filter(f=>fs.existsSync(f)).map(f=>fs.readFileSync(f,'utf8')));
    if(!names||[...names].some(n=>n.startsWith('word:'))) {
      const sync=json(path.join(dir,'sync-points.json'),{points:[]}),points=(sync.points||[]).filter(p=>!names||names.has('word:'+p.id));
      const saved=json(path.join(dir,'.cache/voice-sources.json'),{voices:{}});
      groups.wordSync={points,voices:points.map(p=>({voice:p.voice,source:saved.voices?.[p.voice]||null})),files:points.flatMap(p=>[...(p.method==='aligned'&&p.evidence?[p.evidence]:[]),...(saved.voices?.[p.voice]?.file?[saved.voices[p.voice].file]:[])]).map(f=>sourceFile(path.resolve(dir,f)))};
      if(!names)unknown.push('动态 cue 使用范围无法确定，词锚点来源待核实');
      if(points.some(p=>!saved.voices?.[p.voice]))unknown.push('词锚点实际人声来源未登记，待核实');
    }
    // 任意外部 I/O、动态模块及环境无法从声明文件证明，不能凭阶段成功消除缺口。
    for(const file of scripts)if(fs.existsSync(file)&&/\b(?:fetch|XMLHttpRequest|WebSocket|require|import|process|readFile|Deno|Bun|eval)\b|https?:\/\/|new\s+(?:Image|Audio|Function)\b/.test(fs.readFileSync(file,'utf8')))unknown.push(`动态/外部来源覆盖不足：${file}`);
    const audio=ctx.film.audio||{};
    const refs=[...(audio.tracks||[]),...(audio.voices||[])].map(t=>t.file).filter(Boolean);
    groups.audio={config:audio,files:files(refs),implementation:codeSource(path.join(ENGINE_ROOT,'audio'))};
    if(audio.build)unknown.push('audio.build 动态来源覆盖不足（旧阶段 signature 为 null）');
    groups.renderer={pipeline:codeSource(ctx.pipeline.dir),kits:ctx.kits.map(k=>codeSource(k.dir)),runtime:codeSource(path.join(ENGINE_ROOT,'runtime')),core:engineFiles(['core/cache.mjs','core/word-sync.mjs','core/timing.mjs','core/fonts.mjs'])};
    if(ctx.style.libs?.length)unknown.push('外部风格库的实际加载来源未存档，待核实');
    groups.fonts={declared:ctx.style.fonts||[],files:files(fontFiles)};
    if(ctx.style.fonts?.length&&!fontFiles.length)unknown.push('实际画面字体来源缺失');
    groups.encoding={files:[codeSource(path.join(ENGINE_ROOT,`exporters/${slot.format}`)),...engineFiles(['core/ffmpeg.mjs','core/job.mjs'])],settings:ctx.film.export?.[slot.format]||null};
    if(slot.kind==='draft')groups.rawTracks={files:files(refs)};
  }
  if(sub||caption) {
    const zh=path.join(dir,settings.file),en=path.join(dir,settings.enFile);
    if(caption||slot.format==='zh'||slot.format==='en')groups.zh={source:sourceFile(zh)};
    if((caption&&settings.bilingual)||slot.format==='en')groups.en={source:sourceFile(en)};
    groups.subtitleImplementation={files:engineFiles(['core/subtitles.mjs'])};
  }
  if(caption) {
    const layout=json(path.join(dir,'subtitle-layout.json'),null);
    groups.layout={style:ctx.style.subtitles,regions:layout?.aspects?.[slot.aspect]||null,files:engineFiles(['core/subtitle-layer.mjs','core/subtitle-layer.html','core/subtitle-preflight.mjs'])};
    if(!fontFiles.length)unknown.push('实际字幕字体来源缺失');
  }
  for(const [name,value] of Object.entries(groups)) {
    const walk=v=>{if(!v||typeof v!=='object')return;if(v.error)unknown.push(`${name} 来源无法读取：${v.path}（${v.error}）`);for(const child of Object.values(v))if(typeof child==='object')walk(child);};walk(value);
  }
  return {groups,unknown:[...new Set(unknown)],boundary:'declared-inputs',fontFiles};
}

export function captureFinalGeneration(dir,{slot,fontFiles=[],descriptor=null,inputFiles=[],unknownReasons=[]}={}) {
  const contract=finalContract(dir),target=contract.slots.find(s=>s.slot===slot)||descriptor;
  if(!target)throw new Error(`不是当前交付槽位：${slot}`);
  const deps=dependencies(dir,target,fontFiles);
  deps.unknown.push(...unknownReasons);
  if(inputFiles.length)deps.groups.actualInputs=inputFiles.map(sourceFile);
  const tool=generationTools(target);
  if(tool.executables.some(e=>!e.sha256)||tool.packages.some(p=>!p.source?.snapshot))deps.unknown.push('实际生成工具/依赖身份缺失，待核实');
  return {id:crypto.randomUUID(),slot,descriptor:target,contractDigest:target.contractDigest,createdAt:new Date().toISOString(),dependencies:deps,tool};
}

export function captureFinalProxy(dir,{aspect=null}={}) {
  const ctx=loadFilm(dir,{requireShots:false,aspect}),slot=`${ctx.variant.aspect}/source/proxy`,projection={slot};
  return captureFinalGeneration(dir,{slot,descriptor:{slot,aspect:ctx.variant.aspect,kind:'video',format:'mp4',flavor:'clean',projection,contractDigest:digest(projection)}});
}
export function withGenerationFonts(dir,generation,fontFiles,unknownReasons=[]) {
  const current=dependencies(dir,generation.descriptor,fontFiles);
  generation.dependencies.fontFiles=fontFiles;
  generation.dependencies.groups.fonts=current.groups.fonts;
  generation.dependencies.unknown=generation.dependencies.unknown.filter(r=>r!=='实际画面字体来源缺失');
  if(current.unknown.includes('实际画面字体来源缺失'))generation.dependencies.unknown.push('实际画面字体来源缺失');
  generation.dependencies.unknown.push(...unknownReasons);
  return generation;
}

function sourceStatus(dir,slot,artifact) {
  if(!artifact)return {freshness:'unknown',reasons:['证据未存档，待核实']};
  if(artifact.contractDigest!==slot.contractDigest)return {freshness:'changed',reasons:['相关交付要求已变']};
  if(artifact.provenance==='external-edit')return {freshness:'current',reasons:['外部修改并验收；不声称与引擎源工程逐项一致']};
  if(!artifact.dependencies)return {freshness:'unknown',reasons:['生成时逐项来源证据缺失']};
  const now=dependencies(dir,slot,artifact.dependencies.fontFiles),changed=[];
  if(artifact.dependencies.groups.actualInputs)now.groups.actualInputs=artifact.dependencies.groups.actualInputs.map(e=>sourceFile(e.path));
  for(const [name,old] of Object.entries(artifact.dependencies.groups))if(digest(old)!==digest(now.groups[name]))changed.push(name);
  if(artifact.contractDigest!==slot.contractDigest)changed.push('相关交付要求');
  if(changed.length)return {freshness:'changed',reasons:changed.map(n=>`相关输入已变：${n}`)};
  const unknown=[...artifact.dependencies.unknown,...now.unknown];
  if(!artifact.tool||artifact.tool.node!==process.version||artifact.tool.platform!==process.platform||artifact.tool.arch!==process.arch)unknown.push('生成工具/运行环境身份变化或缺失，待核实');
  for(const saved of artifact.tool?.executables||[])if(digest(saved)!==digest(executable(saved.name)))unknown.push(`生成工具身份变化：${saved.name}，待核实`);
  for(const saved of artifact.tool?.packages||[])if(!saved.source||digest(saved.source)!==digest(codeSource(saved.source.path)))unknown.push(`生成工具依赖身份变化或缺失：${saved.name}，待核实`);
  if(slot.kind==='draft'&&artifact.tool?.pythonPath!==(process.env.PYTHONPATH||null))unknown.push('Python 工具搜索环境变化，待核实');
  return unknown.length?{freshness:'unknown',reasons:[...new Set(unknown)]}:{freshness:'current',reasons:[]};
}

function appendArtifact(dir,data,artifact) {
  const old=data.artifacts.find(a=>a.id===artifact.id);
  if(old&&digest(old)!==digest(artifact))throw new Error('相同产物身份不能覆盖不同证据');
  if(!old)data.artifacts.push(artifact);
  const contract=finalContract(dir);
  if(!data.contracts.some(c=>c.id===contract.id))data.contracts.push(contract);
  const errors=validate('final-delivery',data);if(errors.length)throw new Error(`交付账本证据无效：${errors.join('；')}`);
  atomicJson(ledgerPath(dir),data);return artifact;
}

// 仅由成功导出/字幕写入边界调用。回执先存，账本写入失败仍可 --record 安全重试。
export function recordFinalArtifact(dir,{generation,path:file,stage,technical={status:'unknown',checks:[],errors:[]}}) {
  assertCompatibleProgress(dir);
  const contract=finalContract(dir),slot=contract.slots.find(s=>s.slot===generation.slot)||generation.descriptor;
  if(!slot)throw new Error('生成后交付要求已取消，保留产物，待核实');
  const artifact={id:generation.id,slot:generation.slot,path:path.resolve(file),aspect:slot.aspect,format:slot.format,flavor:slot.flavor,generatedAt:new Date().toISOString(),snapshot:deliverySnapshot(file),contractDigest:generation.contractDigest,dependencies:generation.dependencies,tool:generation.tool,stage,provenance:'generated',technical,openStatus:'not-tested'};
  const receipt=path.join(path.resolve(dir),'.wka/final-delivery-receipts',artifact.id+'.json');
  let data;try{data=ledger(dir);}catch(e){atomicJson(receipt,artifact);throw e;}
  const identity=a=>digest({slot:a.slot,path:a.path,snapshot:a.snapshot,contract:a.contractDigest,dependencies:a.dependencies,tool:a.tool,stage:a.stage,technical:a.technical,provenance:a.provenance});
  const previous=latestArtifact(data,artifact.slot);
  if(previous&&identity(previous)===identity(artifact))return previous;
  atomicJson(receipt,artifact);
  return appendArtifact(dir,data,artifact);
}

export function recordFinalEvidence(dir) {
  assertCompatibleProgress(dir);
  const root=path.join(path.resolve(dir),'.wka/final-delivery-receipts'),data=ledger(dir),recorded=[];
  if(fs.existsSync(root))for(const name of fs.readdirSync(root).sort()) {
    if(!name.endsWith('.json'))continue;
    const artifact=json(path.join(root,name));
    if(data.artifacts.some(a=>a.id===artifact.id))continue;
    if(!artifact.snapshot||digest(deliverySnapshot(artifact.path))!==digest(artifact.snapshot))throw new Error(`待登记产物已变化：${artifact.path}`);
    appendArtifact(dir,data,artifact);recorded.push(artifact.id);
  }
  const pending=json(path.join(path.resolve(dir),'.wka/pending-approval.json'),null);
  if(pending?.deliveryApproval&&!data.approvals.some(a=>a.id===pending.id)) {
    const proof=pending.deliveryApproval;
    if(proof.approval?.id!==pending.id)throw new Error('待存档交付批准身份不一致');
    commitFinalApproval(dir,proof);recorded.push('approval:'+pending.id);
  }
  return recorded;
}

function progress(dir) {
  const file=path.join(path.resolve(dir),'.wka/state.json'),value=json(file,{flow:5,history:[]});
  if(!value||!Array.isArray(value.history||[]))throw new Error(`${file}：流程历史结构损坏`);
  return migrateProgress(value).state;
}
const changedEntries=(before,after)=>[...new Set([...(before?.entries||[]),...(after?.entries||[])].map(e=>e.path))].filter(p=>digest(before?.entries?.find(e=>e.path===p)||null)!==digest(after?.entries?.find(e=>e.path===p)||null));

function nativeCheck(file) {
  const errors=[];
  try {
    const draft=json(path.join(file,'draft_content.json'));
    if(!draft||!draft.materials||!Array.isArray(draft.tracks))throw new Error('native 材料/轨道结构无法核实');
    for(const group of ['videos','audios'])for(const material of draft.materials[group]||[]) {
      if(!material.path){errors.push(`native ${group} 素材路径缺失`);continue;}
      const ref=path.isAbsolute(material.path)?material.path:path.resolve(file,material.path);
      const result=observed(ref);if(result.availability!=='present')errors.push(`native 素材不可读：${ref}`);
    }
  } catch(e){errors.push(`native 草稿无法核实：${e.message}`);}
  return {status:errors.length?'hard-error':'passed',checks:['完整磁盘快照','native JSON 可读','素材存在性'],errors,scope:'磁盘及素材；显示/编辑语义需真实打开依据'};
}
function requireEditorClosed() {
  if(process.platform!=='darwin')return;
  const result=spawnSync('pgrep',['-x',process.env.WKA_JIANYING_PROCESS||'VideoFusion-macOS'],{stdio:'ignore'});
  if(result.status===0)throw new Error('剪映仍在运行，请保存并完全退出后再绑定当前草稿');
  if(result.status!==1)throw new Error('无法核实剪映进程状态，请恢复进程检查后重试；未绑定成功验收');
}

function technicalStatus(dir,slot,artifact) {
  const base=artifact?.technical||{status:'unknown',checks:[],errors:[]};
  if(base.errors?.length)return {...base,status:'hard-error'};
  if(slot.kind!=='video')return base;
  const ctx=loadFilm(dir,{requireShots:false,aspect:slot.aspect}),video=path.join(ctx.variant.cacheDir,'video.mp4'),timing=path.join(ctx.variant.cacheDir,'timing.json');
  const stage=Object.values(json(path.join(dir,'.cache/operations.json'),{stages:{}}).stages||{}).find(s=>s.stage==='review:qc'&&s.aspect===slot.aspect&&!s.proxy&&s.status==='completed');
  const signature=digest({video:fs.existsSync(video)?fileDigest(video):null,timing:fs.existsSync(timing)?fileDigest(timing):null,algorithm:fileDigest(path.join(ENGINE_ROOT,'core/qc.mjs'))});
  if(!stage||stage.signature!==signature||!outputsMatch(stage.outputs))return base;
  const reportFile=stage.outputs.find(o=>o.file.endsWith('.json'))?.file;
  if(!reportFile)return base;
  try {
    const raw=json(reportFile),issues=(raw.issues||[]).map(({id,review,...row})=>{void id;void review;return row;});
    const qc=qcReview(issues,{source:signature,cfg:{...qcConfig(ctx.style,slot.aspect),fps:10,duration:ctx.totalDuration},notes:readReviewNotes(dir)});
    const hard=[...qc.unresolved,...qc.needsFix].filter(i=>!isSoftFinding(i.kind));
    return {...base,status:hard.length?'hard-error':qc.unresolved.length||qc.needsFix.length?'unknown':qc.accepted.length?'accepted-with-warnings':base.status,qc,errors:hard.map(i=>i.msg)};
  }catch(e){return {...base,status:'unknown',errors:[],diagnostic:`当前 QC 证据无法核实：${e.message}`};}
}

function reviewSets(dir,contract,items,data) {
  const result={};
  for(const step of [13,15]) {
    const chosen=items.filter(i=>step===13?i.aspect===contract.mainAspect&&i.kind!=='draft':i.kind==='draft');
    const bindings=chosen.map(i=>({slot:i.slot,path:i.path,artifactId:i.artifactId,snapshot:i.snapshot,contractDigest:i.contractDigest,source:sourceStatus(dir,i,data.artifacts.find(a=>a.id===i.artifactId)),dependencies:dependencies(dir,i,data.artifacts.find(a=>a.id===i.artifactId)?.dependencies?.fontFiles||[])}));
    result[step]={step,bindings,deliveryRevision:digest({step,bindings})};
  }
  // 14 仍先审小样。来源和实际小样字节一并绑定，高清生成后才可继承。
  const operations=json(path.join(dir,'.cache/operations.json'),{stages:{}}),bindings=[];
  for(const aspect of [...new Set(contract.slots.map(s=>s.aspect))].filter(a=>a!==contract.mainAspect)) {
    const ctx=loadFilm(dir,{requireShots:false,aspect}),stage=Object.values(operations.stages||{}).find(s=>s.aspect===aspect&&s.proxy&&s.stage==='review:proxy'&&s.status==='completed');
    const source=latestArtifact(data,`${aspect}/source/proxy`);
    const file=source?.path||stage?.outputs?.[0]?.file||path.join(dir,'review',ctx.variant.review('小样.mp4'));
    const obs=observed(file),target=contract.slots.find(s=>s.aspect===aspect&&s.kind==='video');
    const preflight=json(path.join(dir,'review',ctx.variant.review('字幕预检-proxy.json')),null);
    const deps=target?dependencies(dir,target,source?.dependencies?.fontFiles||finalFontFiles(preflight)):null;
    for(const sub of contract.slots.filter(s=>s.aspect===aspect&&s.kind==='subtitle'))Object.assign(deps.groups,dependencies(dir,sub).groups);
    const generated=source&&digest(source.snapshot)===digest(obs.snapshot)&&['picture','audio','renderer','fonts'].every(g=>digest(source.dependencies?.groups[g]||null)===digest(deps?.groups[g]||null));
    bindings.push({slot:`${aspect}/source/proxy`,aspect,path:file,snapshot:obs.snapshot,stageId:generated?source.id:null,contract:contract.slots.filter(s=>s.aspect===aspect&&s.kind!=='draft').map(s=>s.projection),dependencies:deps});
  }
  result[14]={step:14,bindings,deliveryRevision:digest({step:14,bindings})};
  return result;
}

export function prepareFinalApproval(dir,{id,step,revision,source,note,openEvidence=null}={}) {
  if(![13,14,15].includes(step))throw new Error('交付版本绑定只用于既有 13/14/15 节点');
  dir=path.resolve(dir);const report=finalDeliveryReport(dir),set=report.reviewSets[step],data=ledger(dir);
  const old=data.approvals.find(a=>a.id===id);
  if(old){if(old.revision!==revision||old.step!==step)throw new Error('同一 approval-id 不能绑定不同交付版本');return {existing:old};}
  if(!set||set.deliveryRevision!==revision)throw new Error('交付审阅版本已变化，请重新提交当前版本');
  if(!source?.trim()||!note?.trim()||!id)throw new Error('交付批准需要实际用户来源、结论及 approval-id');
  if(report.errors.length)throw new Error(`交付决定待核实：${report.errors.join('；')}`);
  if(!set.bindings.length)throw new Error('本节点没有实际产物，沿用既有无产物签批，不制造逐文件验收');
  if(step===15)requireEditorClosed();
  const artifacts=[],bindings=[];
  for(const binding of set.bindings) {
    if(!binding.snapshot||!binding.path)throw new Error(`审阅产物缺失或不可读：${binding.slot}`);
    if(step===14){if(!binding.stageId)throw new Error('副版小样缺少成功生成依据');bindings.push(binding);continue;}
    let artifact=data.artifacts.find(a=>a.id===binding.artifactId);
    if(!artifact&&step===15) {
      const item=report.items.find(i=>i.slot===binding.slot);
      artifact={id:null,slot:binding.slot,path:binding.path,aspect:item.aspect,format:item.format,flavor:item.flavor,contractDigest:binding.contractDigest,technical:{status:'unknown'}};
    }
    if(!artifact)throw new Error(`产物缺少生成来源：${binding.slot}`);
    const changed=!artifact.id||digest(artifact.snapshot)!==digest(binding.snapshot);
    let current=artifact;
    if(changed&&step!==15)throw new Error(`产物在生成后变化，须重新核实：${binding.path}`);
    if(changed) {
      if(!['opened','playback-confirmed'].includes(openEvidence?.status)||!openEvidence.source?.trim())throw new Error('手改草稿需要实际打开/播放检查的明确来源');
      const technical=nativeCheck(binding.path);
      if(technical.errors.length)throw new Error(technical.errors.join('；'));
      current={...artifact,id:digest({slot:binding.slot,snapshot:binding.snapshot,approval:id}),snapshot:binding.snapshot,provenance:'external-edit',observedAt:new Date().toISOString(),technical,originalArtifactId:artifact.id,contractDigest:binding.contractDigest};
      artifacts.push(current);
    }
    if(technicalStatus(dir,report.items.find(i=>i.slot===binding.slot),current).status==='hard-error')throw new Error(`确定技术错误不能由验收绕过：${binding.slot}`);
    bindings.push({slot:binding.slot,artifactId:current.id,path:binding.path,snapshot:binding.snapshot,contractDigest:binding.contractDigest});
  }
  if(openEvidence&&!['opened','playback-confirmed'].includes(openEvidence.status))throw new Error('打开依据仅支持 opened / playback-confirmed');
  return {artifacts,approval:{id,step,revision,bindings,source,note,openEvidence,at:new Date().toISOString(),type:step===14?'source':'direct'},review:set};
}

export function commitFinalApproval(dir,prepared) {
  assertCompatibleProgress(dir);
  const data=ledger(dir),approval=prepared.existing||prepared.approval,old=data.approvals.find(a=>a.id===approval.id);
  if(old){if(digest(old)!==digest(approval))throw new Error('批准记录冲突，未覆盖原记录');return old;}
  if(!prepared.review||digest({step:approval.step,bindings:prepared.review.bindings})!==approval.revision)throw new Error('交付批准缺少完整审阅版本证明');
  if(!progress(dir).history?.some(h=>h.approvalId===approval.id&&h.step===approval.step))throw new Error('既有流程批准尚未成功存档，不能追加交付验收');
  const current=finalDeliveryReport(dir).reviewSets[approval.step];
  if(current.deliveryRevision!==approval.revision)throw new Error('批准存档期间交付版本变化，未绑定旧审阅');
  if(approval.step===15)requireEditorClosed();
  for(const a of prepared.artifacts||[])if(!data.artifacts.some(old=>old.id===a.id))data.artifacts.push(a);
  const contract=finalContract(dir);if(!data.contracts.some(c=>c.id===contract.id))data.contracts.push(contract);
  data.approvals.push(approval);
  const errors=validate('final-delivery',data);if(errors.length)throw new Error(`交付账本批准无效：${errors.join('；')}`);
  atomicJson(ledgerPath(dir),data);return approval;
}

function acceptance(dir,item,artifact,data,history) {
  const old=data.approvals.filter(a=>a.bindings.some(b=>b.slot===item.slot)).at(-1);
  if(old) {
    const binding=old.bindings.find(b=>b.slot===item.slot);
    const hasState=history.some(h=>h.approvalId===old.id&&h.step===old.step);
    if(hasState&&item.freshness!=='changed'&&binding.artifactId===artifact?.id&&binding.contractDigest===item.contractDigest&&digest(binding.snapshot)===digest(item.snapshot))return {acceptance:'accepted',approval:{id:old.id,type:old.type,source:old.source,at:old.at},openStatus:old.openEvidence?.status||'not-tested'};
    if(binding.snapshot&&digest(binding.snapshot)!==digest(item.snapshot))return {acceptance:'changed-after-acceptance',changedFiles:changedEntries(binding.snapshot,item.snapshot),reason:'验收后磁盘文件变化，待复核'};
    return {acceptance:'historical-only',reason:'历史已验收，当前相关版本或要求待核实'};
  }
  // 高清只继承实际批准的小样来源；生成证据与相关契约必须逐组匹配。
  if(artifact?.provenance==='generated'&&item.aspect!==finalContract(dir).mainAspect&&item.kind!=='draft'&&item.freshness==='current'&&artifact.technical.status==='passed') {
    for(const approval of [...data.approvals].reverse().filter(a=>a.step===14)) {
      const binding=approval.bindings.find(b=>b.aspect===item.aspect);
      if(!binding||binding.dependencies?.unknown.length||!history.some(h=>h.approvalId===approval.id&&h.step===14)||!binding.contract.some(p=>digest(p)===digest(item.projection)))continue;
      const groups=item.kind==='subtitle'?['zh',...(item.format==='en'?['en']:[])]:['picture','audio',...(item.flavor==='burned'?['zh','en','layout']:[])];
      if(groups.every(g=>digest(binding.dependencies?.groups[g]||null)===digest(artifact.dependencies?.groups[g]||null)))return {acceptance:'accepted',approval:{id:approval.id,type:'inherited',source:approval.source,at:approval.at},openStatus:'not-tested',reason:'来源已批准，高清生成核验通过'};
    }
  }
  const step=item.kind==='draft'?15:item.aspect===finalContract(dir).mainAspect?13:14;
  return history.some(h=>h.step===step)?{acceptance:'historical-only',reason:'历史已验收，当前版本待核实：缺少确切产物绑定链'}:{acceptance:'pending'};
}

function evidencedCandidates(dir,data,items,host) {
  const stages=Object.values(json(path.join(dir,'.cache/operations.json'),{stages:{}}).stages||{});
  const known=[...new Set(data.artifacts.map(a=>a.slot))].map(slot=>latestArtifact(data,slot)).filter(a=>/\/(video|draft|subtitle)\//.test(a.slot)).map(a=>({path:a.path,aspect:a.aspect,kind:a.slot.split('/')[1]}));
  for(const s of stages.filter(s=>s.status==='completed'&&!s.proxy&&(/^(encode:|review:sidecar-)/.test(s.stage)||s.stage==='draft-export')))for(const out of s.outputs||[])known.push({path:out.file,aspect:s.aspect,kind:s.stage==='draft-export'?'draft':s.stage.startsWith('encode:')?'video':'subtitle'});
  const seen=new Set(items.map(i=>i.path)),result=[];
  for(const item of known) {
    if(seen.has(item.path))continue;seen.add(item.path);
    const obs=observed(item.path);if(obs.availability!=='present')continue;
    result.push({...item,...obs,section:'历史/待核实版本',freshness:'unknown',openStatus:'not-tested',...(host==='generic'?{previewStatus:'unverified'}:{link:fileLink(item.path,{host})})});
  }
  return result;
}

export function finalDeliveryReport(dir,{host='codex',aspect=null}={}) {
  assertCompatibleProgress(dir);
  if(!['codex','claude','generic'].includes(host))throw new Error('host 应为 codex、claude 或 generic');
  dir=path.resolve(dir);const contract=finalContract(dir,{aspect}),data=ledger(dir),history=progress(dir).history||[];
  const items=contract.slots.map(s=>{
    const artifact=latestArtifact(data,s.slot),file=artifact?.path||legacyPath(dir,s)||s.path,obs=observed(file);
    const source=sourceStatus(dir,s,artifact);
    const technical=technicalStatus(dir,s,artifact);
    const item={...s,path:file,artifactId:artifact?.id||null,...obs,...source,reasons:[...obs.reasons,...source.reasons,...(technical.errors||[]),...(technical.diagnostic?[technical.diagnostic]:[])],technical:technical.status,technicalEvidence:technical,acceptance:'pending',openStatus:'not-tested'};
    if(artifact&&obs.snapshot&&digest(obs.snapshot)!==digest(artifact.snapshot)) {
      item.freshness='unknown';item.technical='unknown';item.reasons.push('生成后磁盘文件变化，待核实');
    }
    const approval=acceptance(dir,item,artifact,data,history);Object.assign(item,approval);if(approval.reason)item.reasons.push(approval.reason);
    if(item.availability==='present') {
      item.section=item.freshness==='current'?'待审文件':'历史/待核实版本';
      if(item.acceptance==='accepted'&&item.freshness==='current')item.section='当前已验收';
      if(host==='generic')item.previewStatus='unverified';else item.link=fileLink(file,{host});
    }
    return item;
  });
  const ready=items.filter(i=>i.availability==='present'&&i.freshness==='current'&&['passed','accepted-with-warnings'].includes(i.technical));
  const accepted=ready.filter(i=>i.acceptance==='accepted');
  const blocks=items.filter(i=>!accepted.includes(i)).map(i=>{
    const edited=i.kind==='draft'&&i.availability==='present'&&i.acceptance==='changed-after-acceptance';
    return {slot:i.slot,reasons:i.reasons,actor:edited?'reviewer':i.availability!=='present'||i.freshness!=='current'||i.technical==='hard-error'||i.technical==='unknown'?'agent':'reviewer',next:edited?'保存退出剪映并复核当前版本；代理检查素材后重新绑定':i.availability!=='present'?'补齐或核验该产物':i.technical==='hard-error'?'修复该产物的确定技术错误，再提交核验':i.freshness!=='current'?'核对来源/文件变化及证据；保留现有文件':i.technical==='unknown'?'核对输出技术门槛及绑定的检查报告':'审阅并签批当前版本'};
  });
  blocks.push(...contract.errors.map(error=>({slot:null,label:'交付要求',reasons:[error],actor:error.startsWith('缺少明确制作决定')?'reviewer':'agent',next:error.startsWith('缺少明确制作决定')?'补齐尚未明确的交付选择':'依据已有明确来源核对决定与配置差异'})));
  const incomplete=items.some(i=>i.availability!=='present'||i.freshness==='changed'||i.technical==='hard-error');
  let status=ready.length===items.length&&items.length?'awaiting-acceptance':ready.length?'partial':incomplete?'incomplete':'needs-verification';
  if(accepted.length===items.length&&items.length&&!contract.errors.length)status='accepted';
  if(contract.errors.length)status='needs-verification';
  const files=[],auditDiagnostics=[];
  for(const root of ['review','stills'])try{files.push(...treeEvidence(path.join(dir,root)).filter(e=>!/^最终交付(?:清单|审计)/.test(path.basename(e.path))).map(e=>({...e,path:path.join(dir,root,e.path)})));}catch(e){auditDiagnostics.push(`${root} 附录无法完整读取：${e.message}`);}
  const candidates=contract.errors.length?evidencedCandidates(dir,data,items,host):[];
  const references=['.wka/state.json','.cache/operations.json','.wka/decisions.json'].filter(rel=>fs.existsSync(path.join(dir,rel))).map(rel=>sourceFile(path.join(dir,rel)));
  return {version:2,ok:status==='accepted',scope:contract.scope,status,summary:{ready:ready.length,accepted:accepted.length,total:items.length},host,contract,items,candidates,reviewSets:reviewSets(dir,contract,items,data),history:data.artifacts.filter(a=>!items.some(i=>i.artifactId===a.id)),blocks,errors:contract.errors,links:[...items,...candidates].map(i=>i.link).filter(Boolean),audit:{files,ledger:data,references,diagnostics:auditDiagnostics},hostValidation:'未实际打开的文件均为 not-tested；文件指纹不证明播放成功'};
}

function atomicText(file,text) {
  fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.part';
  try{fs.writeFileSync(tmp,text);fs.renameSync(tmp,file);}finally{fs.rmSync(tmp,{force:true});}
}
export function formatFinalDelivery(report) {
  const labels={accepted:'交付完成',partial:'部分完成',incomplete:'未完成','needs-verification':'待核实','awaiting-acceptance':'待验收'};
  const name=i=>i.kind==='video'?(i.flavor==='burned'?'有字幕视频':'无字幕视频'):i.kind==='draft'?'剪映草稿':i.format==='zh'?'中文字幕':'英文字幕';
  const lines=['# 最终交付清单','',`${labels[report.status]} · 可用 ${report.summary.ready}/${report.summary.total} · 已验收 ${report.summary.accepted}/${report.summary.total}`,report.scope==='all'?'范围：全部已确认画幅':`范围：仅 ${report.scope}，不代表整片`,''];
  for(const aspect of [...new Set(report.items.map(i=>i.aspect))]) {
    lines.push(`## ${aspect}`,'');
    for(const i of report.items.filter(i=>i.aspect===aspect)) {
      const label=name(i);
      const status=i.section||(i.availability==='missing'?'缺失':'不可读');
      lines.push(`- ${label} · ${status}${i.artifactId?' · 版本 '+i.artifactId.slice(0,8):''}：${i.link||i.path||'尚无文件'}${i.previewStatus?'（预览未验证）':''}${i.reasons.length?'；'+i.reasons.join('；'):''}`);
    }
    lines.push('');
  }
  if(report.candidates?.length)lines.push('## 已有成果（交付要求待核实）','',...report.candidates.map(i=>`- ${i.aspect} ${i.kind==='draft'?'草稿':i.kind==='video'?'视频':'字幕'} · ${i.section}：${i.link||i.path}`),'');
  lines.push(...report.blocks.map(b=>{const i=report.items.find(i=>i.slot===b.slot);return `- ${i?i.aspect+' '+name(i):b.label}：${b.actor==='agent'?'代理':'用户'} — ${b.next}`;}),...report.errors.map(e=>'- '+e),'');
  if(report.appendix)lines.push('技术材料与完整历史：'+(fileLink(report.appendix.markdown,{host:report.host})||report.appendix.markdown),'');
  lines.push(report.hostValidation,'');return lines.join('\n');
}

export function writeFinalDelivery(dir,options={}) {
  assertCompatibleProgress(dir);
  const report=finalDeliveryReport(dir,options),suffix=report.scope==='all'?'':'-'+report.scope.replace(':','x');
  const base=path.join(path.resolve(dir),'review','最终交付清单'+suffix),audit=path.join(path.resolve(dir),'review','最终交付审计'+suffix);
  report.appendix={json:audit+'.json',markdown:audit+'.md'};
  atomicJson(audit+'.json',report.audit);atomicText(audit+'.md','# 最终交付审计\n\n'+JSON.stringify(report.audit,null,2)+'\n');
  const {audit:details,...brief}=report;void details;
  atomicJson(base+'.json',brief);
  atomicText(base+'.md',formatFinalDelivery(report));
  return brief;
}
