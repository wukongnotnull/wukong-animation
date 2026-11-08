// 主播字幕的分镜定位与实际输出证据。采样只验证字形出现，不验证字幕语义。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicJson, digest, fileDigest, readJson } from './evidence.mjs';
import { openImagePipe, run } from './ffmpeg.mjs';
import { buildFrameTimeline } from './timing.mjs';
import { outputFps } from './render-profile.mjs';
import { parseSrt, planPresenterSubtitles } from './subtitles.mjs';

const escape = value => String(value).replace(/[\r\n]/gu,' ').replace(/[\\|`<>\[\]]/gu,'\\$&');
const time = n => n.toFixed(3);
export const PRESENTER_CHECK = '最终 MP4 主播字幕首中末帧核验';
const statusName = {visible:'可见',missing:'缺失',uncertain:'待人工核对',confirmed:'人工已复核'};

const reviewBase = (ctx,name,proxy) => path.join(ctx.filmDir,'review',ctx.variant.review(name+(proxy?'-proxy':'')));
const outputReport = '主播字幕成片核验';

function writeReview(ctx, name, data, {proxy=false, extra=[]}={}) {
  const base = reviewBase(ctx,name,proxy);
  atomicJson(base+'.json',data);
  const rows = data.rows.map(row=>`| ${row.index} | ${escape(row.text)} | ${time(row.start)}–${time(row.end)} | ${row.shots.map(s=>`${s.id} ${time(s.start)}–${time(s.end)}`).join('、') || '—'} | ${row.frames.join('、')} |`);
  fs.writeFileSync(base+'.md',[
    `# ${name} · ${ctx.variant.aspect}`,'',
    `字幕来源 \`${escape(data.source)}\`，${data.fps} fps。`,'', ...extra,
    '| 字幕 | 文字 | 成片秒数 | 分镜与交叠秒数 | 计划检查帧 |',
    '| --- | --- | --- | --- | --- |', ...rows,'',
    ...data.errors.map(error=>`- ${escape(error)}`),'',
  ].join('\n'));
  return [base+'.md',base+'.json'];
}

export function preparePresenterReview(ctx,settings,{proxy=false}={}) {
  if (settings.bilingual) throw new Error('主播实录字幕模式只显示单行主播字幕，请关闭画面双语字幕');
  const source = path.resolve(ctx.filmDir,settings.file);
  const relative = path.relative(ctx.filmDir,source);
  if (path.isAbsolute(settings.file) || relative==='..' || relative.startsWith('..'+path.sep)) throw new Error('主播实录 SRT 必须是片目录内的相对路径');
  if (!fs.existsSync(source)) throw new Error(`缺少主播实录 SRT：${settings.file}。请补齐已校对的字幕文件。`);
  const content = fs.readFileSync(source,'utf8');
  const subs = parseSrt(content);
  const timeline = buildFrameTimeline(ctx.shots,outputFps(ctx.film,proxy));
  const data = {...planPresenterSubtitles(subs,timeline,settings.blankRanges),source:settings.file,sourceSha256:digest(content)};
  const files = writeReview(ctx,'主播字幕定位',data,{proxy});
  if (data.errors.length) throw new Error(`主播实录字幕校验失败：${data.errors.join('；')}。详见 ${files[0]}`);
  return {subs,data,files,source};
}

function pixelStatus(clean, actual, layer) {
  let count=0, signal=0, cleanError=0, expectedError=0;
  for (let i=0;i<layer.length;i+=4) {
    const alpha=layer[i+3]/255;
    if (alpha<.7) continue;
    for (let c=0;c<3;c++) {
      const before=clean[i+c], after=actual[i+c];
      const delta=(layer[i+c]-before)*alpha;
      if (Math.abs(delta)<22) continue;
      count++;
      signal+=Math.abs(delta);
      cleanError+=Math.abs(after-before);
      expectedError+=Math.abs(after-before-delta);
    }
  }
  if (count<12) return 'uncertain';
  if (expectedError<=.42*signal && cleanError>=.55*signal) return 'visible';
  if (cleanError<=Math.min(count*6,.16*signal) && expectedError>=.82*signal) return 'missing';
  return 'uncertain';
}

const rawArgs = (w,h) => ['-vf',`scale=${w}:${h}:flags=area`,'-an','-pix_fmt','rgba','-f','rawvideo'];
const frameReader = (fd,bytes) => index => {
  const buffer=Buffer.allocUnsafe(bytes);
  if (fs.readSync(fd,buffer,0,bytes,index*bytes)!==bytes) throw new Error('成片核验未读到全部检查帧');
  return buffer;
};

export async function checkPresenterOutput({clean,file,plan,layers,W,H}) {
  const requested=plan.rows.flatMap((row,i)=>row.frames.map(frame=>({index:row.index,frame,layer:i})));
  if (!requested.length || layers.length!==plan.rows.length) throw new Error('没有可用的主播字幕检查帧或字形层');
  const frames=[...new Set(requested.map(s=>s.frame))].sort((a,b)=>a-b);
  const offsets=new Map(frames.map((frame,i)=>[frame,i]));
  const select=frames.map(n=>`eq(n\\,${n})`).join('+');
  const scale=Math.min(1,480/Math.max(W,H));
  const w=Math.round(W*scale),h=Math.round(H*scale),bytes=w*h*4;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-subtitle-proof-'));
  const [rawClean,rawFinal,rawLayers]=['clean','final','layers'].map(f=>path.join(dir,f));
  const fds=[];
  try {
    fs.writeFileSync(path.join(dir,'sample.filter'),`select=${select},scale=${w}:${h}:flags=area`);
    for (const [input,out] of [[clean,rawClean],[file,rawFinal]]) {
      await run(['-i',input,'-filter_script:v',path.join(dir,'sample.filter'),'-fps_mode','passthrough','-an','-pix_fmt','rgba','-f','rawvideo',out]);
      if (fs.statSync(out).size!==frames.length*bytes) throw new Error('成片核验帧数与计划不符');
    }
    const pipe=openImagePipe(['-f','image2pipe','-c:v','png','-i','pipe:0',...rawArgs(w,h),rawLayers]);
    try {
      for (const layer of layers) await pipe.write(fs.readFileSync(layer));
      await pipe.end();
    } catch (error) {
      await pipe.abort();
      throw error;
    }
    for (const f of [rawClean,rawFinal,rawLayers]) fds.push(fs.openSync(f,'r'));
    const [before,after,overlay]=fds.map(fd=>frameReader(fd,bytes));
    let previous=-1, mask;
    return requested.map(sample=>{
      const n=offsets.get(sample.frame);
      if (sample.layer!==previous) {
        mask=overlay(sample.layer);
        previous=sample.layer;
      }
      return {index:sample.index,frame:sample.frame,time:sample.frame/plan.fps,status:pixelStatus(before(n),after(n),mask)};
    });
  } finally {
    for (const fd of fds) fs.closeSync(fd);
    fs.rmSync(dir,{recursive:true,force:true});
  }
}

export function presenterVerdict(samples,proof,confirmation) {
  if (samples.some(s=>s.status==='missing')) return 'missing';
  if (samples.some(s=>s.status==='uncertain')) return proof && confirmation===proof ? 'confirmed' : 'uncertain';
  return 'visible';
}

export function requirePresenterConfirmation(ctx, prepared, confirmation, proxy) {
  const report=readJson(reviewBase(ctx,outputReport,proxy)+'.json');
  if (report?.proof!==confirmation || !['uncertain','confirmed'].includes(report?.verdict) ||
    report.planDigest!==digest(prepared.data) || !fs.existsSync(report.file) || fileDigest(report.file)!==report.sha256) {
    throw new Error('复核摘要与当前主播字幕成片不匹配，请打开最新核验报告');
  }
}

export async function verifyPresenterExport(ctx,{clean,file,prepared,layers,W,H,exportId,proxy,confirmation}) {
  const sha256=fileDigest(file);
  const samples=await checkPresenterOutput({clean,file,plan:prepared.data,layers,W,H});
  if (fileDigest(file)!==sha256 || fileDigest(prepared.source)!==prepared.data.sourceSha256) {
    throw new Error('字幕核验期间成片或 SRT 发生变化，请重新核验');
  }
  const planDigest=digest(prepared.data);
  const proof=digest({file,sha256,exportId,planDigest,samples});
  const verdict=presenterVerdict(samples,proof,confirmation);
  const failures=samples.filter(s=>s.status!=='visible');
  const relative=path.relative(path.join(ctx.filmDir,'review'),file).split(path.sep).map(encodeURIComponent).join('/');
  const files=writeReview(ctx,outputReport,{...prepared.data,file,sha256,exportId,planDigest,proof,samples,verdict},{
    proxy,extra:[
      `[打开成片](${relative}) · ${statusName[verdict]} · 已检查 ${samples.length} 帧。`,'',
      '| 需要核对的字幕 | 帧 | 成片秒数 | 结果 |','| --- | --- | --- | --- |',
      ...failures.map(s=>`| ${s.index} | ${s.frame} | ${time(s.time)} | ${statusName[s.status]} |`),'',
      ...(verdict==='uncertain'?[`看片确认这些帧有字幕后，将 \`--confirm-subtitles ${proof}\` 加到原导出命令，复用当前文件。重导后此确认失效。`,'']:[]),
    ],
  });
  const detail = verdict==='missing' ? '成片有缺失字幕' : verdict==='uncertain' ? '成片字幕待人工核对' : null;
  return {files,verdict,proof,error:detail ? `${detail}，已保留成片。详见 ${files[0]}` : null};
}
