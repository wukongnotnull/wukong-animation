// 实际审听与 QC 人工处置（FR-8）；数值测量不能代替实际审阅。
import fs from 'node:fs';
import path from 'node:path';
import { digest, fileDigest, atomicJson } from './evidence.mjs';
import { validate } from './validate.mjs';

export function readReviewNotes(dir) {
  const file=path.join(dir,'review-notes.json');
  if(!fs.existsSync(file))return {version:1};
  let notes;try{notes=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){throw new Error(`review-notes.json：${e.message}`);}
  const errors=validate('review-notes',notes,'review-notes.json');
  if(errors.length)throw new Error(errors.join('；'));return notes;
}
const validRange=(r,D=Infinity)=>Array.isArray(r)&&r.length===2&&r.every(Number.isFinite)&&r[0]>=0&&r[1]>=r[0]&&r[1]<=D;
const attributed=n=>!!n.reviewer?.trim()&&!!n.evidence?.trim()&&!!n.reviewedAt&&Number.isFinite(Date.parse(n.reviewedAt));
export function audioReview({mix,duration,notes={version:1}}) {
  if(!mix)return {version:1,sha256:null,status:'no-audio',windows:[],errors:[],sectionsDeclared:false,manualRequired:[],boundary:'无声轨，无实际审听对象'};
  const audio=notes.audio||{},sha256=mix?fileDigest(mix):null,errors=[],windows=[];
  const add=(id,label,range)=>{
    const same=windows.find(w=>w.range[0]===range[0]&&w.range[1]===range[1]);
    if(same){same.covers.push(id);same.label+=' / '+label;}else windows.push({id,label,range,covers:[id],status:'not-listened'});
  };
  if(duration>0)add('opening','开场',[0,Math.min(15,duration)]);
  const sections=audio.sections||[],ids=new Set();
  for(const section of sections){
    if(ids.has(section.id)||!validRange(section.range,duration)||section.range[1]===section.range[0]){errors.push(`audio.sections.${section.id}：重复或越界区间`);continue;}
    ids.add(section.id);add(section.id,section.label,section.range);
    if(section.range[0]>0)add('transition:'+section.id,section.label+'转折',[Math.max(0,section.range[0]-2),Math.min(duration,section.range[0]+2)]);
  }
  const stale=!!audio.sha256&&audio.sha256!==sha256;
  for(const w of windows){
    const n=(audio.checks||[]).find(n=>w.covers.includes(n.section)&&validRange(n.range,duration)&&n.range[0]<=w.range[0]&&n.range[1]>=w.range[1]&&attributed(n)&&n.note?.trim()&&['accepted','needs-fix'].includes(n.verdict));
    if(n&&!stale&&audio.sha256===sha256)Object.assign(w,{status:n.verdict,review:n});
  }
  for(const n of audio.checks||[]){
    if(!validRange(n.range,duration))errors.push(`review-notes.json.audio.checks.${n.section}：越界区间`);
    if(['accepted','needs-fix'].includes(n.verdict)&&(!attributed(n)||!n.note?.trim()))errors.push(`review-notes.json.audio.checks.${n.section}：缺少实际审听操作者、时间、结论或证据`);
    if(!windows.some(w=>w.covers.includes(n.section)))errors.push(`review-notes.json.audio.checks.${n.section}：找不到对应窗口`);
  }
  return {version:1,sha256,windows,errors,sectionsDeclared:sections.length>0,status:stale?'stale':errors.length?'invalid':windows.some(w=>w.status==='needs-fix')?'needs-fix':!sections.length||windows.some(w=>w.status==='not-listened')?'not-listened':'accepted',manualRequired:!sections.length?['音乐段落划分未声明，不能认为段落审听完成']:[],boundary:'人工记录仅声明所列范围；RMS/LUFS 测量不代表实际听过'};
}
const SOFT=new Set(['留白不足','点缀过多','点缀色超量','闪烁','突变/闪烁','硬切过多','音效相对电平','音效被盖住']);
export function qcReview(issues,{source,cfg,notes={}}) {
  const rows=issues.map(issue=>({...issue,id:digest({version:1,source,cfg,issue})}));
  const accepted=[],needsFix=[],unresolved=[],staleNotes=[],invalidNotes=[];
  const ids=new Set(rows.map(r=>r.id));
  for(const n of notes.qc||[])if(!ids.has(n.finding))staleNotes.push(n);
  for(const row of rows){
    const n=(notes.qc||[]).find(n=>n.finding===row.id);
    const start=row.t0??row.t??null,end=row.t1??row.t??null;
    const coverage=start===null?validRange(n?.range,cfg?.duration)&&n.range[1]>n.range[0]:validRange(n?.range,cfg?.duration)&&n.range[0]<=start&&n.range[1]>=end;
    if(n&&attributed(n)&&n.reason?.trim()&&coverage&&SOFT.has(row.kind)) {
      if(n.disposition==='accepted'){accepted.push({...row,review:n});continue;}
      if(n.disposition==='needs-fix'){needsFix.push({...row,review:n});continue;}
    }
    if(n)invalidNotes.push({finding:n.finding,error:'review-notes.json.qc：操作者/审阅时间/理由/证据缺失、区间未覆盖，或此项为不能绕过的技术门槛'});
    unresolved.push(row);
  }
  return {machineOk:issues.length===0,reviewStatus:unresolved.length||needsFix.length?'pending':accepted.length?'accepted-with-measurements':'no-findings',issues:rows,accepted,needsFix,unresolved,staleNotes,invalidNotes};
}
export function saveAudioReview(ctx,mix) {
  let report;
  try{report=audioReview({mix,duration:ctx.totalDuration,notes:readReviewNotes(ctx.filmDir)});}
  catch(e){report={version:1,status:'invalid',sha256:mix?fileDigest(mix):null,errors:[e.message],windows:[],manualRequired:[],boundary:'审听记录无效，本次未完成检查'};}
  const base=path.join(ctx.filmDir,'review','声轨审听');atomicJson(base+'.json',report);
  fs.writeFileSync(base+'.md',['# 声轨审听','',mix?`实际音频：${mix}`:'无声轨；没有可播放音频','',`状态：${report.status}`,report.boundary,'',...report.windows.map(w=>`- ${w.label} ${w.range.join('–')}s：${w.status}${w.review?'；'+w.review.note:''}`),...report.manualRequired,...report.errors,''].join('\n'));
  return report;
}
export function saveSfxReview(ctx,mix,rows) {
  if(!rows)return null;
  const issues=rows.filter(r=>!r.missing&&r.diff< -3).map(r=>({kind:'音效相对电平',shot:'音效',t0:r.at,t1:Math.min(ctx.totalDuration,r.at+0.2),msg:`${r.name} ${r.diff.toFixed(1)}dB`,designQuiet:!!r.quiet}));
  const report={measurements:rows,...qcReview(issues,{source:mix?fileDigest(mix):'silent',cfg:{margin:-3,duration:ctx.totalDuration},notes:readReviewNotes(ctx.filmDir)})};
  const file=path.join(ctx.filmDir,'review','音效电平审计.json');atomicJson(file,report);return report;
}
export function draftAudioDifference(ctx,tracks,measured=null) {
  const D=ctx.totalDuration,fade=Math.min(1.2,D*0.1),hasAudio=tracks.length>0;
  const report={version:1,aspect:ctx.variant.aspect,hasAudio,tracks:tracks.map(t=>({file:t.file,start:t.start||0,gain:t.gain||0,ducked:!!t.duckApplied})),master:hasAudio?{fadeOut:fade,targetLUFS:ctx.style.loudness??-18,measuredLUFS:measured}:null,note:hasAudio?'草稿保留当前分轨音量与已烘焙的人声闪避；未应用与成片相同的整体响度标准化和统一尾部淡出，请在剪映核对。':'无音轨，草稿与成片均无声。'};
  const base=path.join(ctx.filmDir,'review',ctx.variant.review('草稿声音差异.json').slice(0,-5));atomicJson(base+'.json',report);
  fs.writeFileSync(base+'.md',['# 草稿声音差异（导出前）','',report.note,'',...(hasAudio?[`成片目标 ${report.master.targetLUFS} LUFS；${measured===null?'当前响度未测量':'实测 '+measured+' LUFS'}；结尾统一淡出 ${fade}s。`]:[]),...report.tracks.map(t=>`- ${t.file}：起点 ${t.start}s，音量 ${t.gain}dB，闪避烘焙 ${t.ducked?'是':'否'}`),''].join('\n'));
  return {report,files:[base+'.md',base+'.json']};
}
