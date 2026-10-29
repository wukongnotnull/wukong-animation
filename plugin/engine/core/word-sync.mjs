// 词锚点的来源与定位；旧逐字点始终只作为估算使用。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validate } from './validate.mjs';
import { countChars } from './subtitles.mjs';
import { usedCueNames } from './cues.mjs';
import { run, probeDuration } from './ffmpeg.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const sourceFile = ctx => path.join(ctx.filmDir,'.cache','voice-sources.json');
const voiceName = (v,i) => v.cue || `vo${i+1}`;
const requestHash = (audio,v) => hash(JSON.stringify({source:audio.voice_source || ((audio.voices || []).some(v=>v.file)?'user':'ai'),text:v.text,voice:v.voice,rate:v.rate,pitch:v.pitch,file:v.file,kind:v.kind || 'vo'}));
function atomic(file,data) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2)+'\n');
  fs.renameSync(file+'.tmp',file);
}

export function writeVoiceSources(ctx,items) {
  const audio=ctx.film.audio || {}, voices={};
  if(audio.voice_source!=='none') (audio.voices || []).forEach((v,i)=>{
    const item=items[i];
    if(!item?.file || !item.duration || !fs.existsSync(item.file)) return;
    voices[voiceName(v,i)]={file:path.relative(ctx.filmDir,item.file),audio_sha256:fileHash(item.file),text_sha256:hash(v.text),request_sha256:requestHash(audio,v),at:v.at,duration:item.duration};
  });
  atomic(sourceFile(ctx),{version:1,voices});
}

function matches(text,needle) {
  const out=[];
  for(let from=0;;) {
    const at=text.indexOf(needle,from);
    if(at<0) return out;
    out.push(at);from=at+1;
  }
}

export function resolveWordSync(ctx) {
  const file=path.join(ctx.filmDir,'sync-points.json');
  if(!fs.existsSync(file)) return {cues:{},evidence:{},points:[]};
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  const errors=validate('sync-points',data,'sync-points.json');
  if(errors.length) throw new Error(errors.join('\n'));
  let sources={};
  try {const saved=JSON.parse(fs.readFileSync(sourceFile(ctx),'utf8'));if(saved.version===1) sources=saved.voices || {};} catch { /* 缺失/损坏的来源不能验证测量 */ }
  const seen=new Set(), cues={}, evidence={};
  for(const p of data.points) {
    const label=`sync-points.json ${p.id}`, key='word:'+p.id;
    if(seen.has(p.id) || Object.hasOwn(ctx.film.cues || {},key)) throw new Error(`${label}：重复 id 或 cue 冲突`);
    seen.add(p.id);
    const audio=ctx.film.audio || {};
    const voice=(audio.voices || []).find((v,i)=>voiceName(v,i)===p.voice);
    if(!voice || audio.voice_source==='none') throw new Error(`${label}：找不到人声 ${p.voice}`);
    const found=matches(voice.text,p.text);
    if(!found.length || (found.length>1 && p.occurrence===undefined) || (p.occurrence || 1)>found.length) throw new Error(`${label}：词不存在或 occurrence 缺失/越界`);
    const at=found[(p.occurrence || 1)-1];
    const measured=p.method!=='estimated';
    if(measured && (!p.source || !p.range || !p.evidence?.trim())) throw new Error(`${label}：测量缺少 source/range/evidence`);
    if(p.range && (p.range.length!==2 || !p.range.every(Number.isFinite) || p.range[0]<0 || p.range[1]<=p.range[0])) throw new Error(`${label}：无效 range`);
    if(p.method==='aligned' && !fs.existsSync(path.resolve(ctx.filmDir,p.evidence))) throw new Error(`${label}：缺少本地对齐证据文件`);
    const source=sources[p.voice];
    let fresh=false,observedAudio=null;
    if(source && Number.isFinite(source.at) && Number.isFinite(source.duration) && source.duration>0 && source.request_sha256===requestHash(audio,voice) && source.text_sha256===hash(voice.text)) {
      try {observedAudio=fileHash(path.resolve(ctx.filmDir,source.file));fresh=observedAudio===source.audio_sha256;} catch { /* 旧音频丢失 */ }
    }
    const measurementValid=measured && fresh && p.source.audio_sha256===source.audio_sha256 && p.source.text_sha256===source.text_sha256;
    const mixCurrent=fresh && source.at===voice.at;
    const verified=measurementValid && mixCurrent;
    if(measurementValid && p.range[1]>source.duration+0.001) throw new Error(`${label}：range 超出人声音频时长`);
    let range;
    if(measurementValid) range=p.range;
    else {
      const first=countChars(voice.text.slice(0,at)), size=countChars(p.text), total=countChars(voice.text);
      if(!size || !total) throw new Error(`${label}：词没有可计时字符`);
      const raw=ctx.film.cues || {};
      const begin=raw[`${p.voice}#${first+1}`], end=raw[`${p.voice}#${first+size}`];
      if(fresh && begin && end) range=[begin[0]-source.at,end[1]-source.at];
      else {
        const recording=voice.file && path.resolve(ctx.filmDir,voice.file);
        const duration=recording && fs.existsSync(recording) ? probeDuration(recording) : 0;
        const span=duration || (fresh?source.duration:Math.max(0.6,total/3.6));
        range=[span*first/total,span*(first+size)/total];
      }
    }
    cues[key]=range.map(t=>voice.at+t);
    evidence[key]={id:p.id,voice:p.voice,text:p.text,occurrence:p.occurrence || 1,matchedIndex:at,method:measurementValid?p.method:'estimated',verified,mixCurrent,
      reason:verified?'来源匹配；声学准确性仍需听审':measurementValid?'原始词标注有效，但声轨位置已变，请重新运行 wka soundtrack':measured?'旧测量失效或缺少当前人声来源，已按当前输入重新估算':'按停顿/字数估算，不是词首实测',
      source: fresh?source:null, input_sha256:hash(JSON.stringify({request:requestHash(audio,voice),audio:observedAudio,point:p,alignment:p.method==='aligned'?fileHash(path.resolve(ctx.filmDir,p.evidence)):null})), evidence:p.evidence || null};
  }
  return {cues,evidence,points:data.points};
}

/** fps 滤镜的近邻采样：输出 j 取原生 ceil((j+.5)*native/output)-1 帧。 */
export function wordFrame(point,shot,{fps,nativeFps=fps,remotion=false}) {
  const target=Math.round(point.in*fps)-shot.startFrame;
  if(target<0 || target>=shot.frames) return {frame:Math.round(target*nativeFps/fps),outputFrame:target,valid:false,reason:'词首不在当前镜头可呈现范围内'};
  let frame=target;
  if(remotion && fps!==nativeFps) {
    const sample=j=>Math.min(shot.nativeFrames-1,Math.ceil((j+0.5)*nativeFps/fps)-1);
    frame=target===0?0:sample(target-1)+1;
    if(sample(target)<frame) return {frame,outputFrame:target,valid:false,reason:'镜尾重复帧无法定位该词首'};
  }
  return {frame,outputFrame:target,globalFrame:shot.startFrame+target,valid:true};
}

export function prepareWordShots(job) {
  const resolved=resolveWordSync(job);
  const film={...job.film,cues:{...job.film.cues,...resolved.cues}};
  const shots=job.shots.map(shot=>{
    const files=[shot.path,...job.styleScripts,...job.filmScripts];
    const used=usedCueNames(files.filter(f=>fs.existsSync(f)).map(f=>fs.readFileSync(f,'utf8')));
    const keys=Object.keys(resolved.cues).filter(key=>!used || used.has(key));
    const wordFrames={}, points=[];
    for(const key of keys) {
      const loc=wordFrame({in:resolved.cues[key][0]},shot,{fps:job.fps,nativeFps:job.film.fps,remotion:job.pipeline.name==='remotion'});
      wordFrames[key]=loc.frame;
      points.push({key,...resolved.evidence[key],...loc,range:resolved.cues[key],shot:shot.id});
    }
    return {...shot,wordFrames,wordPoints:points,renderStart:shot.startFrame/job.fps};
  });
  return {...job,film,shots,wordEvidence:resolved.evidence};
}

export async function writeWordReview(job,{video=null,renderStills=null}={}) {
  const points=job.shots.flatMap(s=>s.wordPoints || []);
  const stem=job.variant.review('词级同步.json').slice(0,-5)+(job.proxy?'-proxy':'');
  const base=path.join(job.filmDir,'review',stem);
  const dir=base;
  const images=[];
  atomic(base+'.json',{version:1,status:'证据生成中/未验证',points:[]});
  fs.writeFileSync(base+'.md','# 词级同步\n\n证据生成中/未验证，旧结论不可复用。\n');
  try {
  for(const p of points) {
    p.images=[];
    const shot=job.shots.find(s=>s.id===p.shot);
    if(!p.valid) continue;
    fs.mkdirSync(dir,{recursive:true});
    for(const delta of [-1,0,1]) {
      const local=p.outputFrame+delta;
      if(local<0 || local>=shot.frames) continue;
      const out=path.join(dir,`${p.id}-${p.shot}-${delta+1}.png`);
      if(video) await run(['-i',video,'-vf',`select=eq(n\\,${shot.startFrame+local})`,'-frames:v','1',out]);
      else if(renderStills) {
        const t=local/job.fps;
        const files=await renderStills([{shot:shot.id,t}],dir);
        fs.copyFileSync(files[0],out);
      } else continue;
      p.images.push(out);images.push(out);
    }
    if(p.source) {
      const inPoint=p.range[0]-(job.film.audio.voices.find((v,i)=>voiceName(v,i)===p.voice)?.at || 0);
      const start=Math.max(0,inPoint-0.2), end=Math.min(p.source.duration,inPoint+0.6);
      p.audio=path.join(dir,`${p.id}.wav`);
      await run(['-ss',String(start),'-i',path.resolve(job.filmDir,p.source.file),'-t',String(end-start),p.audio]);
    }
  }
  } catch(e) {
    atomic(base+'.json',{version:1,status:'证据生成失败/未验证',errors:[e.message],points:[]});
    fs.writeFileSync(base+'.md','# 词级同步\n\n证据生成失败/未验证：'+e.message+'\n');
    throw e;
  }
  const report={version:1,generatedAt:new Date().toISOString(),inputSignature:hash(JSON.stringify(points.map(p=>[p.key,p.input_sha256,p.range,p.frame,p.shot]))),aspect:job.variant.aspect,fps:job.fps,status:!points.length?'未声明词级检查':points.every(p=>p.valid && p.verified)?'来源有效/定位可验证；画面响应待人工核对':'存在未验证词点；画面响应待人工核对',points};
  atomic(base+'.json',report);
  fs.writeFileSync(base+'.md',[`# 词级同步 · ${job.variant.aspect}`, '',report.status,'',
    ...points.flatMap(p=>[`- ${p.shot} ${p.text}：${p.method}；${p.reason}；全片 ${p.range[0].toFixed(3)}s；目标帧 ${p.globalFrame ?? '范围外'}。${p.valid?'':p.reason}`, ...p.images.map(f=>`  - [查看帧](<${f}>)`),...(p.audio?[`  - [听人声](<${p.audio}>)`]:[])]),'','源代码引用不是正确视觉响应的证明；请在既有审片节点核对。',''].join('\n'));
  job.log(`  词级同步：${base}.md（${report.status}）`);
  return report;
}
