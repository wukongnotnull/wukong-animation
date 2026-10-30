// 交付核验与明确制作决定（FR-7）。
import fs from 'node:fs';
import path from 'node:path';
import { recoveryStatus } from './operations.mjs';
import { atomicJson, readJson, treeEvidence } from './evidence.mjs';
import { loadFilm } from './job.mjs';
import { validate } from './validate.mjs';
import { aspectOf } from './variants.mjs';
import { readProgress } from './state.mjs';
import { parseArgs } from '../bin/args.mjs';
import { subtitleSettings,subtitleOutputs } from './subtitles.mjs';
export { finalDeliveryReport, writeFinalDelivery } from './final-delivery.mjs';

function expectedFiles(dir,ctx,aspect) {
  const active=readJson(path.join(dir,'.cache/active-command.json'));
  const {cmd,opt}=parseArgs(active?.argv||(readProgress(dir).step>=13?['final',dir]:[]));
  const settings=subtitleSettings(ctx.film,ctx.variant),proxy=!!opt('proxy'),review=name=>path.join(dir,'review',ctx.variant.review(name));
  if(cmd==='soundtrack')return ctx.film.audio?.build||ctx.film.audio?.tracks?.length||(ctx.film.audio?.voice_source!=='none'&&ctx.film.audio?.voices?.length)?[review('声轨.m4a')]:[];
  if(cmd==='animatic')return [review('动态分镜.mp4'),review('接触表.jpg')];
  if(cmd==='render')return proxy?[review('小样.mp4')]:[];
  if(cmd==='subtitles')return settings.mode==='none'?[]:[path.join(dir,settings.file),...(settings.bilingual?[path.join(dir,settings.enFile)]:[]),...(opt('preview')?[review('字幕预览.mp4')]:[])];
  if(cmd!=='final')return [];
  const raw=typeof opt('formats')==='string'?opt('formats').split(','):ctx.film.export?.formats||['mp4'];
  const visual=raw.filter(f=>f!=='jianying'),names=subtitleOutputs(settings.mode,settings.bilingual),out=[];
  const add=(format,suffix)=>{const exporter=ctx.registry.exporters.get(format);if(exporter)out.push(path.join(dir,`${ctx.variant.exportName}${suffix}${proxy?'-proxy':''}.${exporter.ext}`));};
  if(names.burned!==null)for(const f of visual)add(f,names.burned);
  if(names.clean!==null)for(const f of names.burned===null?visual:visual.length?['mp4']:[])add(f,names.clean);
  if(visual.length&&!proxy){if(names.srt!==null)out.push(path.join(dir,ctx.variant.exportName+names.srt+'.srt'));if(names.srtEn)out.push(path.join(dir,ctx.variant.exportName+names.srtEn+'.srt'));}
  if(raw.includes('jianying')){
    const stage=recoveryStatus(dir).stages.find(s=>s.stage==='draft-export'&&s.aspect===(aspect||ctx.variant.aspect));
    out.push(stage?.value||path.join(dir,'review','草稿完成回执缺失'));
  }
  return out;
}

export function fileLink(file,{host='codex',cwd=process.cwd()}={}) {
  if(!['codex','claude','generic'].includes(host)) throw new Error('host 应为 codex、claude 或 generic');
  if(host==='generic')return null;
  const absolute=path.resolve(file),relative=path.relative(cwd,absolute);
  const target=host==='claude'&&!relative.startsWith('..')?relative:absolute;
  const label=absolute.replace(/([\\[\]])/g,'\\$1');
  const encoded=encodeURI(target).replace(/#/g,'%23').replace(/\(/g,'%28').replace(/\)/g,'%29');
  return `[${label}](<${encoded}>)`;
}
export function readDecisions(dir) {
  const file=path.join(dir,'.wka/decisions.json');
  if(!fs.existsSync(file)) return {version:1,delivery:{status:'unknown'}};
  let value;try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){throw new Error(`decisions.json：${e.message}`);}
  const errors=validate('decisions',value,'decisions.json');
  for(const key of ['delivery','aspects','subtitles','materials']) {
    const item=value[key];
    if(item?.status==='confirmed'&&(!item.source?.trim()||item.value===undefined)) errors.push(`decisions.json.${key}：明确选择需要值与实际来源`);
    if(key==='materials'&&Array.isArray(item?.value)) for(const m of item.value) if(m.path&&!fs.existsSync(path.resolve(dir,m.path))) errors.push(`decisions.json.materials：素材缺失 ${m.path}`);
  }
  if(errors.length) throw new Error(errors.join('；'));
  return value;
}
export function decisionConflicts(ctx,decisions) {
  const errors=[];
  const main=loadFilm(ctx.filmDir,{requireShots:false});
  if(decisions.aspects?.status==='confirmed'&&JSON.stringify(decisions.aspects.value)!==JSON.stringify([aspectOf(main.film.size),...Object.keys(main.film.variants||{})])) errors.push('已确认画幅与 film.json 不一致，请核实最新明确选择');
  if(decisions.subtitles?.status==='confirmed') {
    const chosen=decisions.subtitles.value;
    if(chosen.mode!==(ctx.film.subtitles?.mode||'none')||!!chosen.bilingual!==!!ctx.film.subtitles?.bilingual) errors.push('已确认字幕方式/双语与 film.json 不一致，请核实最新明确选择');
  }
  return errors;
}
const kind=file=>/试听/.test(file)?'试听':/声轨/.test(file)?'声轨':/接触表|sheet/.test(file)?'接触表':/动态分镜/.test(file)?'动态分镜':/\.(srt|json)$/.test(file)?'字幕或报告':/\.(mp4|gif|webm)$/.test(file)?'视频':/\.(png|jpg)$/.test(file)?'图片':fs.statSync(file).isDirectory()?'草稿':'报告';
export function deliveryReport(dir,{aspect=null,host='codex',required=[]}={}) {
  if(!['codex','claude','generic'].includes(host))throw new Error('host 应为 codex、claude 或 generic');
  dir=path.resolve(dir);const ctx=loadFilm(dir,{requireShots:false,aspect:aspect==='all'?null:aspect});
  const selected=aspect==='all'?null:ctx.variant.aspect,items=[],seen=new Set();
  const add=(file,info={})=>{
    file=path.resolve(file);if(seen.has(file)||file.startsWith(path.join(dir,'.cache')+path.sep))return;seen.add(file);
    const exists=fs.existsSync(file),status=!exists?'missing':info.status||'unverified';
    items.push({path:file,kind:exists?kind(file):'缺失',aspect:info.aspect||null,proxy:!!info.proxy,status,stage:info.stage||null,generatedAt:info.completedAt||null,sha256:info.sha256||null,openStatus:'not-tested',...(host==='generic'?{previewStatus:'unverified'}:status==='current'?{link:fileLink(file,{host})}:{})});
  };
  for(const s of recoveryStatus(dir).stages.filter(s=>(!selected||s.aspect===selected)&&(/^(review:|encode:)/.test(s.stage)||s.stage==='draft-export'))) for(const out of s.outputs||[]) add(out.file,{...s,sha256:out.sha256,status:s.status==='completed'?'current':s.status==='stale'||s.status==='user-modified'?'stale':'unverified'});
  for(const root of ['review','stills']) for(const f of treeEvidence(path.join(dir,root))) if(!/交付清单/.test(f.path)) add(path.join(dir,root,f.path));
  for(const f of fs.readdirSync(dir)) if(/\.(mp4|gif|webm|srt)$/.test(f)) add(path.join(dir,f));
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
  const report=deliveryReport(dir,options),suffix=options.aspect&&options.aspect!=='all'?'-'+options.aspect.replace(':','x'):'';
  const base=path.join(path.resolve(dir),'review','交付清单'+suffix);
  atomicJson(base+'.json',report);
  fs.writeFileSync(base+'.md',['# 交付清单','',...(report.host==='generic'?report.items.filter(i=>i.status==='current').map(i=>'- '+i.path+'（'+i.kind+'；previewStatus: unverified）'):report.links.map(link=>'- '+link)),'',...report.items.filter(i=>i.status!=='current').map(i=>`- ${i.status}：${i.path}`),'',...report.errors.map(e=>'- '+e),'',report.hostValidation,''].join('\n'));
  return report;
}
