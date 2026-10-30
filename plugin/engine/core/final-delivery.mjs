// 最终交付：查询不执行制作代码、不迁移流程、不刷新阶段缓存。
import fs from 'node:fs';
import path from 'node:path';
import { digest, atomicJson, treeEvidence } from './evidence.mjs';
import { loadFilm } from './job.mjs';
import { fileLink, readDecisions, decisionConflicts } from './delivery.mjs';
import { subtitleSettings, subtitleOutputs } from './subtitles.mjs';

const ledgerPath=dir=>path.join(path.resolve(dir),'.wka/final-delivery.json');
function json(file,fallback) {
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(e){if(e.code==='ENOENT')return fallback;throw new Error(`${file}：${e.message}`);}
}
function ledger(dir) {
  const value=json(ledgerPath(dir),{version:1,contracts:[],artifacts:[],approvals:[]});
  if(value?.version!==1||!['contracts','artifacts','approvals'].every(k=>Array.isArray(value[k])))throw new Error(`${ledgerPath(dir)}：交付账本结构损坏`);
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
      else entries.push({path:rel||path.basename(name),size:st.size,sha256:digest(fs.readFileSync(name))});
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
  const selected=aspect&&aspect!=='all'?[aspect]:all;
  if(selected.some(a=>!configured.includes(a)||!all.includes(a)))throw new Error('请求画幅不在已确认及已配置范围内');
  const slots=[];
  for(const a of selected) {
    if(!configured.includes(a))continue;
    const ctx=loadFilm(dir,{requireShots:false,aspect:a}),settings=subtitleSettings(ctx.film,ctx.variant),names=subtitleOutputs(settings.mode,settings.bilingual);
    const formats=(ctx.film.export?.formats||['mp4']).filter(f=>f!=='jianying');
    // 草稿命令/格式不能取消视频承诺；未声明视频格式时沿用既有 mp4 默认值。
    if(!formats.length)formats.push('mp4');
    const add=(kind,format,flavor,suffix)=>{
      const slot=[a,kind,format,...(flavor?[flavor]:[])].join('/');
      const ext=kind==='subtitle'?'srt':ctx.registry.exporters.get(format)?.ext;
      const file=kind==='draft'?null:path.join(dir,ctx.variant.exportName+suffix+'.'+ext);
      const projection={slot,name:ctx.variant.exportName,...(kind==='video'?{size:ctx.film.size,fps:ctx.film.fps}:{}),...(flavor==='burned'?{bilingual:settings.bilingual}:{})};
      slots.push({slot,aspect:a,kind,format,flavor:flavor||null,path:file,projection,contractDigest:digest(projection)});
    };
    if(names.burned!==null)for(const f of formats)add('video',f,'burned',names.burned);
    if(names.clean!==null)for(const f of names.burned===null?formats:['mp4'])add('video',f,'clean',names.clean);
    if(names.srt!==null)add('subtitle','zh',null,names.srt);
    if(names.srtEn)add('subtitle','en',null,names.srtEn);
    if(decisions.delivery?.value==='video-and-draft')add('draft','jianying',null,'');
  }
  return {id:digest(slots.map(s=>s.projection)),scope:aspect&&aspect!=='all'?aspect:'all',mainAspect:main.variant.aspect,decisions,slots,errors};
}

function observed(file) {
  if(!file)return {availability:'missing',snapshot:null,reasons:['尚无实际导出路径']};
  try{return {availability:'present',snapshot:deliverySnapshot(file),reasons:[]};}
  catch(e){return {availability:e.code==='ENOENT'?'missing':'unreadable',snapshot:null,reasons:[e.message]};}
}

export function finalDeliveryReport(dir,{host='codex',aspect=null}={}) {
  if(!['codex','claude','generic'].includes(host))throw new Error('host 应为 codex、claude 或 generic');
  dir=path.resolve(dir);const contract=finalContract(dir,{aspect}),data=ledger(dir);
  const items=contract.slots.map(s=>{
    const artifact=data.artifacts.filter(a=>a.slot===s.slot).at(-1),file=artifact?.path||s.path,obs=observed(file);
    const item={...s,path:file,artifactId:artifact?.id||null,...obs,freshness:'unknown',technical:'unknown',acceptance:'pending',openStatus:'not-tested'};
    item.reasons.push(artifact?'来源证据待核实':'证据未存档，待核实');
    if(item.availability==='present') {
      item.section='历史/待核实版本';
      if(host==='generic')item.previewStatus='unverified';else item.link=fileLink(file,{host});
    }
    return item;
  });
  const ready=items.filter(i=>i.availability==='present'&&i.freshness==='current'&&['passed','accepted-with-warnings'].includes(i.technical));
  const accepted=ready.filter(i=>i.acceptance==='accepted');
  const blocks=items.filter(i=>!accepted.includes(i)).map(i=>({slot:i.slot,reasons:i.reasons,actor:i.availability!=='present'?'agent':'reviewer',next:i.availability!=='present'?'补齐或核验该产物':'核对当前版本及其证据'}));
  let status=ready.length===items.length&&items.length?'awaiting-acceptance':ready.length?'partial':items.some(i=>i.availability!=='present')?'incomplete':'needs-verification';
  if(accepted.length===items.length&&items.length&&!contract.errors.length)status='accepted';
  if(contract.errors.length)status='needs-verification';
  const files=['review','stills'].flatMap(root=>treeEvidence(path.join(dir,root)).filter(e=>!/^最终交付(?:清单|审计)/.test(path.basename(e.path))).map(e=>({...e,path:path.join(dir,root,e.path)})));
  return {version:2,ok:status==='accepted',scope:contract.scope,status,summary:{ready:ready.length,accepted:accepted.length,total:items.length},host,contract,items,history:data.artifacts.filter(a=>!items.some(i=>i.artifactId===a.id)),blocks,errors:contract.errors,links:items.map(i=>i.link).filter(Boolean),audit:{files,ledger:data},hostValidation:'未实际打开的文件均为 not-tested；文件指纹不证明播放成功'};
}

export function writeFinalDelivery(dir,options={}) {
  const report=finalDeliveryReport(dir,options),suffix=report.scope==='all'?'':'-'+report.scope.replace(':','x');
  const base=path.join(path.resolve(dir),'review','最终交付清单'+suffix),audit=path.join(path.resolve(dir),'review','最终交付审计'+suffix);
  report.appendix={json:audit+'.json',markdown:audit+'.md'};
  atomicJson(audit+'.json',report.audit);fs.writeFileSync(audit+'.md','# 最终交付审计\n\n'+JSON.stringify(report.audit,null,2)+'\n');
  const {audit:details,...brief}=report;void details;
  atomicJson(base+'.json',brief);
  fs.writeFileSync(base+'.md',['# 最终交付清单','',`${report.status} · ${report.summary.ready}/${report.summary.total} · 范围 ${report.scope}`,'',...report.items.map(i=>`- ${i.aspect} ${i.kind} ${i.flavor||i.format}：${i.section||i.availability} ${i.link||i.path||'尚无文件'}；${i.reasons.join('；')}`),'',...report.blocks.map(b=>`- ${b.slot}：${b.actor} — ${b.next}`),...report.errors.map(e=>'- '+e),'',fileLink(audit+'.md',{host:options.host})||audit+'.md','',report.hostValidation,''].join('\n'));
  return brief;
}
