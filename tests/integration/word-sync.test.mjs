import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const WKA=fileURLToPath(new URL('../../plugin/engine/bin/wka.mjs',import.meta.url));
const home=fs.mkdtempSync(path.join(os.tmpdir(),'wka-word-home-'));
const env={...process.env,WUKONG_ANIMATION_HOME:home,WKA_NO_FONT_DOWNLOAD:'1'};
const cli=(...args)=>spawnSync(process.execPath,[WKA,...args],{env,encoding:'utf8',maxBuffer:8e6});
for(const pipeline of ['browser','remotion']) {
 const d=path.join(home,'styles',`word-${pipeline}`);fs.mkdirSync(d,{recursive:true});
 fs.writeFileSync(path.join(d,'style.json'),JSON.stringify({id:`word-${pipeline}`,name:'词级测试',category:'xinxi',order:998,engine:'>=0.1.0',pipeline,kits:{},fps:30,aspects:['16:9','9:16'],keywords:['test']}));
 test(`${pipeline} 词首随实际音频锚点出现，横竖/小样/奇数fps`,{timeout:600000},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-word-film-'));fs.mkdirSync(path.join(dir,'shots'));
  try {
   const wave=path.join(dir,'voice.wav');
   const tone=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',"aevalsrc='0.2*sin(2*PI*440*t)*(between(t,0.2,0.25)+between(t,1.05,1.1)+between(t,2.11,2.16))':s=48000:d=3",wave]);assert.equal(tone.status,0,String(tone.stderr));
   const terms=['有素材','无素材','纯文字'];
   const ext=pipeline==='browser'?'js':'tsx';
   const bits=terms.map((_,i)=>`f >= s.cueFrame('word:p${i}') ? 255 : 0`);
   const lead=pipeline==='browser'?"wk.shot({render(ctx,t,s){ctx.fillStyle='black';ctx.fillRect(0,0,s.W,s.H);}})":"import React from 'react';export default ()=> <div/>;";
   const body=pipeline==='browser'?`wk.shot({render(ctx,t,s){const f=s.frame;ctx.fillStyle='rgb('+[${bits.join(',')}].join(',')+')';ctx.fillRect(0,0,s.W,s.H);}});`:`import React from 'react';import {AbsoluteFill,useCurrentFrame} from 'remotion';export default function Shot({s}){const f=useCurrentFrame();return <AbsoluteFill style={{background:'rgb('+[${bits.join(',')}].join(',')+')'}}/>;}`;
   fs.writeFileSync(path.join(dir,'shots',`s01.${ext}`),lead);fs.writeFileSync(path.join(dir,'shots',`s02.${ext}`),body);
   const film={title:'word',style:`word-${pipeline}`,size:[32,18],fps:30,seed:1,variants:{'9:16':{}},shots:[{id:'s01',file:`shots/s01.${ext}`,duration:0.17},{id:'s02',file:`shots/s02.${ext}`,duration:3.12}],audio:{voice_source:'user',voices:[{cue:'v01',text:terms.join('，'),at:0.17,file:'voice.wav'}]}};
   const filmFile=path.join(dir,'film.json');fs.writeFileSync(filmFile,JSON.stringify(film));
   const track=cli('soundtrack',dir);assert.equal(track.status,0,track.stderr);
   const recording=fs.readFileSync(wave),savedMix=fs.readFileSync(path.join(dir,'.cache','mix.wav'));
   const source=JSON.parse(fs.readFileSync(path.join(dir,'.cache','voice-sources.json'))).voices.v01;
   const times=[0.2,1.05,2.11];
   fs.writeFileSync(path.join(dir,'sync-points.json'),JSON.stringify({version:1,points:terms.map((text,i)=>({id:`p${i}`,voice:'v01',text,method:'manual',range:[times[i],times[i]+0.05],source:{audio_sha256:source.audio_sha256,text_sha256:source.text_sha256},evidence:'固定音频脉冲测试标注'}))}));
   const originalSRT='1\n00:00:00,200 --> 00:00:01,000\n手改字幕\n';fs.writeFileSync(path.join(dir,'subtitles.srt'),originalSRT);
   for(const fps of (process.env.WKA_WORD_RATE?[Number(process.env.WKA_WORD_RATE)]:[30,25])) for(const aspect of [null,'9:16']) for(const proxy of [false,true]) {
    film.fps=fps;fs.writeFileSync(filmFile,JSON.stringify({...film,cues:JSON.parse(fs.readFileSync(filmFile)).cues}));
    const r=cli('render',dir,...(aspect?['--aspect',aspect]:[]),...(proxy?['--proxy']:[]));assert.equal(r.status,0,r.stderr+r.stdout.slice(-2500));
    const out=path.join(dir,'.cache',...(aspect?['9x16']:[]),proxy?'video-proxy.mp4':'video.mp4');
    const decoded=spawnSync('ffmpeg',['-v','error','-i',out,'-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','-'],{maxBuffer:1e6});assert.equal(decoded.status,0,String(decoded.stderr));
    const rate=proxy?Math.round(fps/2):fps;
    for(let channel=0;channel<3;channel++) {
     let first=-1;for(let n=0;n<decoded.stdout.length/3;n++) if(decoded.stdout[n*3+channel]>180){first=n;break;}
     assert.ok(first>=0);
     assert.ok(Math.abs(first/rate-(0.17+times[channel]))<=1/rate+1e-6,`${pipeline} ${fps}/${rate} 词${channel}：${first/rate}`);
    }
   }
   assert.equal(fs.readFileSync(path.join(dir,'subtitles.srt'),'utf8'),originalSRT);
   assert.deepEqual(fs.readFileSync(wave),recording,'原录音不变');
   assert.deepEqual(fs.readFileSync(path.join(dir,'.cache','mix.wav')),savedMix,'量化尾隙仅编码补齐，不改已存混音');
   const pointFile=path.join(dir,'sync-points.json'),data=JSON.parse(fs.readFileSync(pointFile));
   data.points[0].range[0]+=0.01;fs.writeFileSync(pointFile,JSON.stringify(data));
   const changed=cli('render',dir,'--proxy','--aspect','9:16');assert.equal(changed.status,0,changed.stderr);
   assert.match(changed.stdout,/s01 缓存命中/);assert.doesNotMatch(changed.stdout,/s02 缓存命中/);
  } finally {if(process.env.WKA_WORD_KEEP) console.log('诊断目录 '+dir); else fs.rmSync(dir,{recursive:true,force:true});}
 });
}
