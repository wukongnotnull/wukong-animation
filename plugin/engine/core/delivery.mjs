// 交付核验与明确制作决定（FR-7）。
import fs from 'node:fs';
import { reviewFile, finalFile, REVIEW_DIR, FINAL_DIR } from './layout.mjs';
import path from 'node:path';
import { recoveryStatus } from './operations.mjs';
import { atomicJson, readJson, treeEvidence } from './evidence.mjs';
import { loadFilm } from './film-context.mjs';
import { fileLink, readDecisions, decisionConflicts } from './delivery-inputs.mjs';
export { fileLink, readDecisions, decisionConflicts } from './delivery-inputs.mjs';
import { aspectOf } from './variants.mjs';
import { readProgress, assertActiveProduction } from './state.mjs';
import { parseArgs } from './command-args.mjs';
import { voiceReviewStatus } from './voice-review.mjs';
import { scopedPath } from './workbench-catalog.mjs';
export { finalDeliveryReport, writeFinalDelivery } from './final-delivery.mjs';

function expectedFiles(dir,ctx,aspect) {
  const active=readJson(path.join(dir,'.cache/active-command.json'));
  const {cmd,opt}=parseArgs(active?.argv||(readProgress(dir).step>=7?['final',dir]:[]));
  const proxy=!!opt('proxy'),review=name=>reviewFile(dir,ctx.variant.review(name));
  if(cmd==='soundtrack')return ctx.film.audio?.build||ctx.film.audio?.tracks?.length||(ctx.film.audio?.voice_source!=='none'&&ctx.film.audio?.voices?.length)?[reviewFile(dir,'声轨.m4a')]:[];
  if(cmd==='animatic')return [review('动态分镜.mp4'),review('接触表.jpg')];
  if(cmd==='render')return proxy?[review('小样.mp4')]:[];
  if(cmd!=='final')return [];
  const raw=typeof opt('formats')==='string'?opt('formats').split(','):ctx.film.export?.formats||['mp4'];
  const visual=raw.filter(f=>f!=='jianying'),out=[];
  const add=(format,suffix)=>{const exporter=ctx.registry.exporters.get(format);if(exporter)out.push(finalFile(dir,`${ctx.variant.exportName}${suffix}${proxy?'-proxy':''}.${exporter.ext}`));};
  for(const f of visual)add(f,'');
  if(raw.includes('jianying')){
    const stage=recoveryStatus(dir).stages.find(s=>s.stage==='draft-export'&&s.aspect===(aspect||ctx.variant.aspect));
    out.push(stage?.value||reviewFile(dir,'草稿完成回执缺失'));
  }
  return out;
}

const kind=file=>/声轨/.test(file)?'声轨':/接触表|sheet/.test(file)?'接触表':/动态分镜/.test(file)?'动态分镜':/\.json$/.test(file)?'检查结果':/\.(mp4|gif|webm)$/.test(file)?'视频':/\.(png|jpg)$/.test(file)?'图片':fs.statSync(file).isDirectory()?'草稿':'报告';
function voiceDeliveryReport(dir, film, host, required) {
  const review = voiceReviewStatus(dir), errors = [...review.issues];
  const files = [...(film.audio?.voices || []).map(voice => ({ file: voice.file, kind: '人声录音' })),
    { file: 'story.md', kind: '剧本' }, { file: 'review/台词/台词定位.md', kind: '台词定位' }];
  const items = files.map(({ file, kind }) => {
    const absolute = scopedPath(dir, file), exists = fs.existsSync(absolute);
    const status = !exists ? 'missing' : review.ready ? 'current' : 'stale';
    if (!exists) errors.push(`必需人声交付物缺失：${file}`);
    return { path: absolute, kind, status, aspect: null, proxy: false, stage: 'voice', openStatus: 'not-tested',
      ...(status === 'current' && host !== 'generic' ? { link: fileLink(absolute, { host }) } : {}) };
  });
  for (const file of required) {
    const absolute = scopedPath(dir, file);
    if (!items.some(item => item.path === absolute)) items.push({ path: absolute, kind: '附加必需项', status: fs.existsSync(absolute) ? 'unverified' : 'missing', openStatus: 'not-tested' });
    if (items.find(item => item.path === absolute)?.status !== 'current') errors.push(`必需项未核实：${file}`);
  }
  return { version: 1, ok: !errors.length, aspect: null, host, items, errors, decisions: readDecisions(dir),
    links: items.map(item => item.link).filter(Boolean), hostValidation: '未实际打开的录音均为 not-tested；存在性不代表已经试听或签批' };
}

export function deliveryReport(dir,{aspect=null,host='codex',required=[]}={}) {
  if(!['codex','claude','generic'].includes(host))throw new Error('host 应为 codex、claude 或 generic');
  dir=path.resolve(dir);const ctx=loadFilm(dir,{requireShots:false,requireTimeline:false,aspect:aspect==='all'?null:aspect});
  if ((readProgress(dir).step === 4 || !ctx.shots.length) && ctx.film.audio?.voice_source !== 'none') return voiceDeliveryReport(dir, ctx.film, host, required);
  const selected=aspect==='all'?null:ctx.variant.aspect,items=[],seen=new Set();
  const add=(file,info={})=>{
    file=path.resolve(file);if(seen.has(file)||file.startsWith(path.join(dir,'.cache')+path.sep))return;seen.add(file);
    const exists=fs.existsSync(file),status=!exists?'missing':info.status||'unverified';
    items.push({path:file,kind:exists?kind(file):'缺失',aspect:info.aspect||null,proxy:!!info.proxy,status,stage:info.stage||null,generatedAt:info.completedAt||null,sha256:info.sha256||null,openStatus:'not-tested',...(host==='generic'?{previewStatus:'unverified'}:status==='current'?{link:fileLink(file,{host})}:{})});
  };
  for(const s of recoveryStatus(dir).stages.filter(s=>(!selected||s.aspect===selected)&&(/^(review:|encode:)/.test(s.stage)||s.stage==='draft-export'))) for(const out of s.outputs||[]) add(out.file,{...s,sha256:out.sha256,status:s.status==='completed'?'current':s.status==='stale'||s.status==='user-modified'?'stale':'unverified'});
  for(const root of [REVIEW_DIR]) for(const f of treeEvidence(path.join(dir,root))) if(!/交付清单/.test(f.path)) add(path.join(dir,root,f.path));
  if(fs.existsSync(path.join(dir,FINAL_DIR)))for(const f of fs.readdirSync(path.join(dir,FINAL_DIR))) if(/\.(mp4|gif|webm|srt)$/.test(f)) add(path.join(dir,FINAL_DIR,f));
  const frames=aspect==='all'?[aspectOf(ctx.film.size),...Object.keys(ctx.film.variants||{})]:[ctx.variant.aspect];
  const expected=frames.flatMap(a=>expectedFiles(dir,loadFilm(dir,{requireShots:false,aspect:a}),a));
  required=[...required,...expected];
  for(const file of required) add(path.resolve(dir,file));
  const decisions=readDecisions(dir),errors=decisionConflicts(ctx,decisions);
  if(!items.some(i=>i.status==='current'))errors.push('没有已核实的当前交付物');
  for(const i of items) if((i.status==='missing'||i.status==='stale')&&(!required.length||required.some(file=>path.resolve(dir,file)===i.path)))errors.push(`${i.status}：${i.path}`);
  for(const file of required) if(items.find(i=>i.path===path.resolve(dir,file))?.status!=='current')errors.push(`必需项未核实：${file}`);
  return {version:1,ok:!errors.length,aspect:aspect||ctx.variant.aspect,host,items,links:items.filter(i=>i.status==='current').map(i=>i.link).filter(Boolean),errors,decisions,hostValidation:'未实际打开的文件均为 not-tested；存在性不代表宿主播放成功'};
}
export function writeDelivery(dir,options={}) {
  assertActiveProduction(dir);
  const report=deliveryReport(dir,options),suffix=options.aspect&&options.aspect!=='all'?'-'+options.aspect.replace(':','x'):'';
  const base=reviewFile(dir,'交付清单'+suffix,{ensure:true});
  atomicJson(base+'.json',report);
  fs.writeFileSync(base+'.md',['# 交付清单','',...(report.host==='generic'?report.items.filter(i=>i.status==='current').map(i=>'- '+i.path+'（'+i.kind+'；previewStatus: unverified）'):report.links.map(link=>'- '+link)),'',...report.items.filter(i=>i.status!=='current').map(i=>`- ${i.status}：${i.path}`),'',...report.errors.map(e=>'- '+e),'',report.hostValidation,''].join('\n'));
  return report;
}
