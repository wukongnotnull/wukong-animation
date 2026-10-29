import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const WKA=fileURLToPath(new URL('../../plugin/engine/bin/wka.mjs',import.meta.url));
const home=fs.mkdtempSync(path.join(os.tmpdir(),'wka-preflight-home-'));
const env={...process.env,WUKONG_ANIMATION_HOME:home,WKA_NO_FONT_DOWNLOAD:'1'};
const cli=(...args)=>spawnSync(process.execPath,[WKA,...args],{env,encoding:'utf8',maxBuffer:8e6});
for(const pipeline of ['browser','remotion']) {
 const style=path.join(home,'styles',`sub-${pipeline}`);fs.mkdirSync(style,{recursive:true});fs.writeFileSync(path.join(style,'style.json'),JSON.stringify({id:`sub-${pipeline}`,name:'字幕测试',category:'xinxi',order:997,engine:'>=0.1.0',pipeline,kits:{},fps:10,keywords:['test'],aspects:['16:9','9:16'],subtitles:{safe_area:[0.05,0.05,0.9,0.9],bottom:0.1}}));
 test(`${pipeline} 横竖单双语实测字框、样张、签名与手改文件保护`,{timeout:600000},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-字幕 预检-'));fs.mkdirSync(path.join(dir,'shots'));
  try {
   const ext=pipeline==='browser'?'js':'tsx';
   const source=pipeline==='browser'?"wk.shot({render(ctx,t,s){ctx.fillStyle=t<.7?'white':'black';ctx.fillRect(0,0,s.W,s.H);}})":"import React from 'react';import {AbsoluteFill,useCurrentFrame} from 'remotion';export default function Shot({s}){const f=useCurrentFrame();return <AbsoluteFill style={{background:f/s.fps<.7?'white':'black'}}/>;}";
   fs.writeFileSync(path.join(dir,'shots',`s01.${ext}`),source);
   const film={title:'preflight',style:`sub-${pipeline}`,size:[320,180],fps:10,seed:1,shots:[{id:'s01',file:`shots/s01.${ext}`,duration:1.5}],variants:{'9:16':{}},subtitles:{mode:'both'}};
   const filmFile=path.join(dir,'film.json');fs.writeFileSync(filmFile,JSON.stringify(film));
   for(const aspect of [null,'9:16']) {
    const suffix=aspect?'.9x16':'',outSuffix=aspect?'-9x16':'';
    const srt='1\n00:00:00,100 --> 00:00:01,400\n有素材 A-roll\n';
    const en=JSON.stringify([{zh:'有素材 A-roll',en:'Footage A-roll'}],null,4)+'\n';
    fs.writeFileSync(path.join(dir,`subtitles${suffix}.srt`),srt);fs.writeFileSync(path.join(dir,`subtitles.en${suffix}.json`),en);
    const args=aspect?['--aspect',aspect]:[];
    const render=cli('render',dir,'--proxy',...args);assert.equal(render.status,0,render.stderr);
    for(const bilingual of [false,true]) {
     film.subtitles.bilingual=bilingual;fs.writeFileSync(filmFile,JSON.stringify(film));
     const r=cli('subtitles',dir,'--preflight',...args);assert.equal(r.status,0,r.stderr+r.stdout.slice(-2500));
     const report=JSON.parse(fs.readFileSync(path.join(dir,'review',`字幕预检${outSuffix}-proxy.json`)));
     assert.equal(report.errors.length,0);assert.ok(report.manual_required.length>0);
     assert.equal(report.measurements[0].rects.length,bilingual?2:1);
     assert.ok(report.images.some(i=>i.kind==='实际画面'));
     for(const c of ['white','black','gray']) assert.ok(report.images.some(i=>i.kind==='合成测试-'+c));
     assert.ok(fs.existsSync(report.contactSheet));
     assert.equal(fs.readFileSync(path.join(dir,`subtitles${suffix}.srt`),'utf8'),srt);
     assert.equal(fs.readFileSync(path.join(dir,`subtitles.en${suffix}.json`),'utf8'),en);
    }
   }
   // 主版的重要标签与字幕字框相交，预览应保留诊断并失败。
   const report=JSON.parse(fs.readFileSync(path.join(dir,'review','字幕预检-proxy.json')));
   const r=report.measurements[0].rects[0];
   fs.writeFileSync(path.join(dir,'subtitle-layout.json'),JSON.stringify({version:1,aspects:{'16:9':{s01:[{id:'label',label:'分句拼接',rect:[r.x/report.W,r.y/report.H,r.w/report.W,r.h/report.H],time:[0,1.5]}]}}}));
   const bad=cli('subtitles',dir,'--preview');assert.notEqual(bad.status,0);assert.match(bad.stderr,/分句拼接/);
   fs.rmSync(path.join(dir,'subtitle-layout.json'));
   const fixed=cli('subtitles',dir,'--preview');assert.equal(fixed.status,0,fixed.stderr);
   const accepted=cli('signoff',dir,'字幕人工确认','--step','11');assert.equal(accepted.status,0,accepted.stderr);
   // 修改样式后，不得沿用旧预检签批。
   film.subtitles.style={bottom:0.2};fs.writeFileSync(filmFile,JSON.stringify(film));
   const stale=cli('signoff',dir,'字幕确认','--step','11');assert.notEqual(stale.status,0);assert.match(stale.stderr,/过期/);
   fs.rmSync(path.join(dir,'subtitles.en.json'));
   const missing=cli('subtitles',dir,'--preflight');assert.notEqual(missing.status,0);
   assert.equal(fs.existsSync(path.join(dir,'subtitles.en.json')),false,'预检不擅自创建英文稿');
   assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'review','字幕预检-proxy.json'))).errors.length>0,'缺英文也保留失败报告');
  } finally {if(process.env.WKA_SUB_KEEP) console.log('字幕诊断目录 '+dir);else fs.rmSync(dir,{recursive:true,force:true});}
 });
}
