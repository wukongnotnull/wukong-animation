// 实际字幕布局检查；未知画面内容与可读性始终保留人工待查。
// 版式预检（layout）用于还没有小样的第 10 道：时间轴按 film.json 计算，只在纯色底上出样张。
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {renderSubtitleLayers,subtitleStyle,prepareSubtitleFonts,subtitleFontSignature} from './subtitle-layer.mjs';
import {subtitleSettings,parseSrt,attachEnglish,checkSubtitles} from './subtitles.mjs';
import {validate} from './validate.mjs';
import {requireTiming,buildFrameTimeline} from './timing.mjs';
import { outputFps } from './render-profile.mjs';
import {hashParts} from './cache.mjs';
import {run} from './ffmpeg.mjs';

const intersects=(a,b)=>a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y;
const normalized=(r)=>Array.isArray(r) && r.length===4 && r.every(Number.isFinite) && r[0]>=0 && r[1]>=0 && r[2]>0 && r[3]>0 && r[0]+r[2]<=1+1e-9 && r[1]+r[3]<=1+1e-9;
const pixels=(r,W,H)=>({x:r[0]*W,y:r[1]*H,w:r[2]*W,h:r[3]*H});
const stem=(ctx,proxy,layout)=>ctx.variant.review('字幕预检.json').slice(0,-5)+(layout?'-版式':proxy?'-proxy':'');
const fileOf=(ctx,proxy,layout)=>path.join(ctx.filmDir,'review',stem(ctx,proxy,layout)+'.json');
/** 预检报告的路径（不含扩展名），交付登记用 */
export const preflightBase=(ctx,{proxy=true,layout=false}={})=>fileOf(ctx,proxy,layout).slice(0,-5);

export function checkSubtitleGeometry({subs,measurements,W,H,requestedSize,style,shots,regions}) {
 const errors=[],warnings=[],manual_required=['亮暗背景可读性和完整动画遮挡仍需人工审阅；几何检查不理解画面语义'];
 const canvas={x:0,y:0,w:W,h:H};
 const safe=style.safe_area && normalized(style.safe_area)?pixels(style.safe_area,W,H):canvas;
 if(style.safe_area && !normalized(style.safe_area)) errors.push('safe_area 必须是画布内的归一化 [x,y,w,h]');
 if(!style.safe_area) manual_required.push('未配置平台安全区，只检查画布边界');
 if(!regions || !Object.values(regions).some(a=>a.length)) manual_required.push('未声明重要内容区域，自动遮挡检查未覆盖');
 const contains=(a,b)=>b.x>=a.x-0.5 && b.y>=a.y-0.5 && b.x+b.w<=a.x+a.w+0.5 && b.y+b.h<=a.y+a.h+0.5;
 for(const [i,m] of measurements.entries()) {
  const sub=subs[i],label=`第 ${sub.index} 条`;
  if(!m.loaded) errors.push(`${label} 字体布局未能确认`);
  if(m.zh<requestedSize*0.8 || (m.en!==null && m.en<requestedSize*0.8)) warnings.push(`${label} 字号缩小超过 20%，请检查实际可读性`);
  for(const rect of m.rects) {
   if(!contains(canvas,rect)) errors.push(`${label} ${rect.lang} 字框超出画布`);
   if(!contains(safe,rect)) errors.push(`${label} ${rect.lang} 字框超出安全区`);
   for(const shot of shots) {
    const start=Math.max(sub.start,shot.start),end=Math.min(sub.end,shot.start+shot.duration);
    if(start>=end) continue;
    for(const region of regions?.[shot.id] || []) if(start<shot.start+region.time[1] && end>shot.start+region.time[0] && intersects(rect,pixels(region.rect,W,H))) errors.push(`${shot.id} ${label} 与重要内容「${region.label}」重叠（${start.toFixed(3)}–${end.toFixed(3)}s）`);
   }
  }
 }
 if(regions) for(const s of shots) if(!regions[s.id]?.length) manual_required.push(`${s.id} 未声明重要内容区域，需人工核对`);
 return {errors:[...new Set(errors)],warnings:[...new Set(warnings)],manual_required:[...new Set(manual_required)]};
}

function readRegions(ctx) {
 const file=path.join(ctx.filmDir,'subtitle-layout.json');
 if(!fs.existsSync(file)) return null;
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 const schemaErrors=validate('subtitle-layout',data,'subtitle-layout.json');
 if(schemaErrors.length) throw new Error(schemaErrors.join('；'));
 if(data.version!==1 || !data.aspects || typeof data.aspects!=='object') throw new Error('subtitle-layout.json 需 version:1 与 aspects');
 const own=data.aspects[ctx.variant.aspect];
 if(own===undefined) return null;
 for(const [id,regions] of Object.entries(own)) {
  const shot=ctx.shots.find(s=>s.id===id),seen=new Set();
  if(!shot || !Array.isArray(regions)) throw new Error(`subtitle-layout.json ${id}：镜号不存在或不是区域数组`);
  for(const r of regions) {
   if(!r.id || seen.has(r.id) || typeof r.label!=='string' || !r.label.trim() || !normalized(r.rect) || !Array.isArray(r.time) || r.time.length!==2 || !r.time.every(Number.isFinite) || r.time[0]<0 || r.time[1]<=r.time[0] || r.time[1]>shot.duration+0.001) throw new Error(`subtitle-layout.json ${id}/${r.id}：id、rect 或 time 无效`);
   seen.add(r.id);
  }
 }
 return own;
}

function inputs(ctx,{proxy,subs=null,layout=false}) {
 const timing=layout?buildFrameTimeline(ctx.shots,outputFps(ctx.film,proxy)):requireTiming(ctx,{proxy});
 const settings=subtitleSettings(ctx.film,ctx.variant);
 const textFile=path.join(ctx.filmDir,settings.file);
 if(!fs.existsSync(textFile)) throw new Error(`还没有 ${settings.file}，先运行 wka subtitles 生成字幕，再预检`);
 const srt=fs.readFileSync(textFile,'utf8');
 {
  subs=parseSrt(srt);
  if(settings.bilingual) subs=attachEnglish(subs,JSON.parse(fs.readFileSync(path.join(ctx.filmDir,settings.enFile),'utf8')));
 }
 const style=subtitleStyle(ctx.style), workDir=path.join(ctx.variant.cacheDir,'work');
 const fonts=prepareSubtitleFonts({style,subs,workDir});
 const scale=proxy?0.5:1;
 const [W,H]=ctx.film.size.map(n=>Math.round(n*scale/2)*2);
 const signature=hashParts([srt,settings.bilingual?{file:path.join(ctx.filmDir,settings.enFile)}:'',style,settings.protectedTerms || [],{W,H,fps:timing.fps,aspect:ctx.variant.aspect},
  {file:path.join(ctx.filmDir,'subtitle-layout.json')},subtitleFontSignature(fonts),{file:fileURLToPath(new URL('./subtitle-layer.html',import.meta.url))},{file:fileURLToPath(new URL('./subtitle-layer.mjs',import.meta.url))},{file:fileURLToPath(new URL('./subtitle-preflight.mjs',import.meta.url))},
  layout?{layout:ctx.shots.map(s=>[s.id,s.duration])}:{file:path.join(ctx.variant.cacheDir,proxy?'video-proxy.mp4':'video.mp4')}]);
 return {signature,settings,style,subs,W,H,workDir,timing,fonts};
}

async function samples(ctx,{subs,W,H,video,layers,style,regions,proxy,layout}) {
 const dir=path.join(ctx.filmDir,'review',stem(ctx,proxy,layout));fs.mkdirSync(dir,{recursive:true});
 const images=[];
 const rate=proxy?Math.max(1,Math.round(ctx.film.fps/2)):ctx.film.fps;
 if(video) for(const [i,sub] of subs.entries()) for(const [part,t] of [['起',sub.start],['中',(sub.start+sub.end)/2],['末',Math.max(sub.start,sub.end-1/rate)]]) {
  const out=path.join(dir,`${i+1}-${part}.png`);
  await run(['-ss',String(t),'-i',video,'-i',layers.files[i],'-filter_complex','[0:v][1:v]overlay=0:0','-frames:v','1',out]);
  const gray=spawnSync('ffmpeg',['-v','error','-i',out,'-vf','scale=8:8','-pix_fmt','gray','-f','rawvideo','-']);
  if(gray.status!==0) throw new Error('无法分析字幕样张：'+String(gray.stderr));
  const brightness=[...gray.stdout].reduce((a,b)=>a+b,0)/Math.max(1,gray.stdout.length);
  images.push({file:out,index:sub.index,time:t,kind:'实际画面',brightness});
 }
 // 代表样张涵盖长文字、字号缩小和最亮/最暗场景；全部起中末帧仍逐一保留。
 const selected=new Set();
 const byWidth=layers.measurements.map((m,i)=>({i,width:Math.max(...m.rects.map(r=>r.w),0),height:m.rects.reduce((a,r)=>a+r.h,0)}));
 for(const key of ['width','height']) for(const p of [...byWidth].sort((a,b)=>b[key]-a[key]).slice(0,2)) selected.add(images.find(i=>i.index===subs[p.i].index));
 if(images.length) {selected.add([...images].sort((a,b)=>a.brightness-b.brightness)[0]);selected.add([...images].sort((a,b)=>b.brightness-a.brightness)[0]);}
 for(const item of [...selected].filter(Boolean)) {
  const i=subs.findIndex(s=>s.index===item.index),measurement=layers.measurements[i];
  const boxes=[...(style.safe_area?[pixels(style.safe_area,W,H)]:[]),...measurement.rects];
  const shot=ctx.shots.find(s=>item.time>=s.start && item.time<s.start+s.duration);
  for(const region of regions?.[shot?.id] || []) if(item.time>=shot.start+region.time[0] && item.time<shot.start+region.time[1]) boxes.push(pixels(region.rect,W,H));
  const filter=boxes.map(b=>`drawbox=x=${b.x}:y=${b.y}:w=${Math.max(1,b.w)}:h=${Math.max(1,b.h)}:color=lime@0.7:t=1`).join(',') || 'null';
  item.guides=item.file.replace('.png','-guides.png');
  await run(['-i',item.file,'-vf',filter,'-frames:v','1',item.guides]);
 }
 const maxIdx=byWidth.sort((a,b)=>b.width-a.width)[0]?.i;
 if(maxIdx!==undefined) for(const color of ['white','black','gray']) {
  const out=path.join(dir,`合成-${color}.png`);
  const grid=color==='gray'?',drawgrid=w=32:h=32:t=1:c=white@0.3':'';
  await run(['-f','lavfi','-i',`color=c=${color}:s=${W}x${H}${grid}`,'-i',layers.files[maxIdx],'-filter_complex','[0:v][1:v]overlay=0:0','-frames:v','1',out]);
  images.push({file:out,index:subs[maxIdx].index,time:null,kind:`合成测试-${color}`});selected.add(images.at(-1));
 }
 const picks=[...selected].filter(Boolean).slice(0,12);
 let contactSheet=null;
 if(picks.length) {
  const tw=320,th=Math.round(tw*H/W/2)*2;
  const scaled=picks.map((_,i)=>`[${i}:v]scale=${tw}:${th}[s${i}]`).join(';');
  const layout=picks.map((_,i)=>`${i%3*tw}_${Math.floor(i/3)*th}`).join('|');
  contactSheet=path.join(dir,'接触表.jpg');
  await run([...picks.flatMap(p=>['-i',p.guides || p.file]),'-filter_complex',picks.length===1?scaled+';[s0]null':scaled+';'+picks.map((_,i)=>`[s${i}]`).join('')+`xstack=inputs=${picks.length}:layout=${layout}:fill=gray`,'-frames:v','1',contactSheet]);
 }
 return {images,contactSheet};
}

function save(ctx,proxy,layout,report) {
 const file=fileOf(ctx,proxy,layout);fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file+'.tmp',JSON.stringify(report,null,2)+'\n');fs.renameSync(file+'.tmp',file);
 fs.writeFileSync(file.slice(0,-5)+'.md',[`# 字幕${layout?'版式':''}预检 · ${ctx.variant.aspect}`,'',report.errors.length?'✗ 机器检查发现确定错误':'机器检查未发现确定错误；人工项目待审','',`测量 ${report.W ? `${report.W}×${report.H} @${report.fps}fps` : "未完成"}；签名 ${report.signature || '无'}`,'',
  ...['errors','warnings','manual_required'].flatMap(k=>[`## ${k}`,'',...report[k].map(e=>`- ${e}`),'']),
  ...(report.contactSheet?[`[查看接触表](<${report.contactSheet}>)`,'']:[]),
  ...(report.images || []).flatMap(i=>[`- 第 ${i.index} 条 · ${i.kind} · ${i.time===null?'无实片时刻':i.time.toFixed(3)+'s'}：[原始样张](<${i.file}>)${i.guides?` · [辅助线](<${i.guides}>)`:''}`]),''].join('\n'));
}

export async function preflightSubtitles(ctx,{proxy=true,video,subs=null,layout=false,log=()=>{}}={}) {
 const label=layout?'版式':proxy?'小样':'高清';
 log(`[${ctx.variant.aspect} ${label} · subtitle-preflight] 开始`);
 let report={version:1,layout,errors:[],warnings:[],manual_required:[],images:[]},layers;
 try {
  const data=inputs(ctx,{proxy,subs,layout});
  const {signature,settings,style,W,H,workDir,timing}=data;subs=data.subs;
  report={...report,signature,W,H,fps:timing.fps,style,fontSignature:subtitleFontSignature(data.fonts),fontReport:data.fonts.report,fontCss:data.fonts.css,fontStacks:data.fonts.stacks};
  const regions=readRegions(ctx);
  const check=checkSubtitles(subs,{duration:ctx.totalDuration,maxChars:settings.maxChars,protectedTerms:settings.protectedTerms});
  layers=await renderSubtitleLayers({W,H,style,subs,workDir,log});
  const shots=ctx.shots.map((s,i)=>({...s,start:timing.shots[i].startFrame/timing.fps,duration:timing.shots[i].frames/timing.fps}));
  const geometry=checkSubtitleGeometry({subs,measurements:layers.measurements,W,H,requestedSize:layers.requestedSize,style,shots,regions});
  report={...report,...geometry,errors:[...check.errors,...geometry.errors],warnings:[...check.warnings,...geometry.warnings],measurements:layers.measurements};
  if(layout) report.manual_required.push('还没有小样，未在实际画面上核对；第 11 道渲染小样后用 --preview 复查遮挡与可读性');
  const actualVideo=layout?null:video || path.join(ctx.variant.cacheDir,proxy?'video-proxy.mp4':'video.mp4');
  report={...report,...await samples(ctx,{subs,W,H,video:actualVideo,layers,style,regions,proxy,layout})};
 } catch(e) {report.errors.push(e.message);}
 save(ctx,proxy,layout,report);
 log(`字幕预检：${fileOf(ctx,proxy,layout).replace(/\.json$/,'.md')}`);
 for(const msg of report.warnings) log('  ! '+msg);
 for(const msg of report.manual_required) log('  · 人工待查：'+msg);
 if(report.errors.length) throw new Error('字幕预检失败：'+report.errors.join('；'));
 log(`[${ctx.variant.aspect} ${label} · subtitle-preflight] 完成`);
 return {report,layers,subs};
}

export async function requireSubtitlePreflight(ctx,{proxy=true,layout=false}={}) {
 const settings=subtitleSettings(ctx.film,ctx.variant);
 if(settings.mode==='none') return null;
 const file=fileOf(ctx,proxy,layout);
 if(!fs.existsSync(file)) throw new Error((layout?'缺少当前字幕版式预检，请先运行 wka subtitles --preflight':proxy?'缺少基于小样的字幕预检，请先 wka render --proxy 再运行 wka subtitles --preview':'缺少当前字幕预检，请先运行 wka subtitles --preflight')+(ctx.variant.isMain?'':` --aspect ${ctx.variant.aspect}`));
 const report=JSON.parse(fs.readFileSync(file,'utf8'));
 const current=inputs(ctx,{proxy,layout});
 if(report.signature!==current.signature) throw new Error('字幕预检已过期，请重新生成预览/预检');
 if(report.errors.length) throw new Error('字幕预检存在确定错误，不能签批：'+report.errors.join('；'));
 const measured=await renderSubtitleLayers({W:current.W,H:current.H,style:current.style,subs:current.subs,workDir:current.workDir});
 if(JSON.stringify(measured.measurements)!==JSON.stringify(report.measurements)) throw new Error('字幕字体/字框测量已变化，预检过期，请重新预检');
 return report;
}
