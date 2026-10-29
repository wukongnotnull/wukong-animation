import {test} from 'node:test';import assert from 'node:assert/strict';
const api=await import('../../plugin/engine/core/subtitle-preflight.mjs').catch(()=>({}));
test('出界、已知标签冲突和未声明区域分别报告',()=>{
 assert.equal(typeof api.checkSubtitleGeometry,'function','缺少实际字框预检');
 const subs=[{index:1,start:0,end:1,text:'分句拼接'}];
 const measurements=[{index:1,zh:10,en:null,loaded:true,rects:[{lang:'zh',x:10,y:75,w:80,h:15}]}];
 const input={subs,measurements,W:100,H:100,requestedSize:10,style:{safe_area:[0.1,0.1,0.8,0.8]},shots:[{id:'s01',start:0,duration:1}],regions:null};
 let r=api.checkSubtitleGeometry(input);assert.equal(r.errors.length,0);assert.ok(r.manual_required.length>0);
 input.regions={s01:[{id:'label',label:'分句拼接',rect:[0.1,0.8,0.8,0.1],time:[0,1]}]};
 assert.match(api.checkSubtitleGeometry(input).errors.join(' '),/s01.*分句拼接/);
 input.measurements[0].rects[0].y=91;
 assert.match(api.checkSubtitleGeometry(input).errors.join(' '),/画布|安全区/);
});
test('缩小字号、字体状态和safe_area有效性',()=>{
 assert.equal(typeof api.checkSubtitleGeometry,'function');
 const input={subs:[{index:1,start:0,end:1,text:'字幕'}],measurements:[{index:1,zh:7,en:null,loaded:true,rects:[]}],W:100,H:100,requestedSize:10,style:{},shots:[],regions:null};
 assert.match(api.checkSubtitleGeometry(input).warnings.join(' '),/20%/);
 input.measurements[0].loaded=false;
 assert.ok(api.checkSubtitleGeometry(input).errors.some(s=>s.includes('字体')));
});

test('Keynote 1080×1920 双语真实字框在1500底边内；film覆盖保留',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const {loadFilm}=await import('../../plugin/engine/core/job.mjs');
 const {renderSubtitleLayers,subtitleStyle}=await import('../../plugin/engine/core/subtitle-layer.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-caption-keynote-'));
 const old=process.env.WKA_NO_FONT_DOWNLOAD;process.env.WKA_NO_FONT_DOWNLOAD='1';
 try {
  const film={title:'字框',style:'keynote',size:[1920,1080],fps:30,seed:1,shots:[{id:'s01',file:'missing.tsx',duration:1}],variants:{'9:16':{}},subtitles:{mode:'both',bilingual:true}};
  const file=path.join(dir,'film.json');fs.writeFileSync(file,JSON.stringify(film));
  let ctx=loadFilm(dir,{aspect:'9:16',requireShots:false});
  assert.equal(ctx.style.subtitles.bottom,420/1920);
  const layers=await renderSubtitleLayers({W:1080,H:1920,style:subtitleStyle(ctx.style),subs:[{index:1,start:0,end:1,text:'有素材 A-roll',en:'Footage A-roll'}],workDir:path.join(dir,'work')});
  assert.equal(layers.measurements[0].rects.length,2);
  for(const r of layers.measurements[0].rects) {assert.ok(r.y+r.h<=1500.5,JSON.stringify(r));assert.ok(r.x>=71.5);assert.ok(r.x+r.w<=1008.5);}
  film.subtitles.style={bottom:0.1};film.variants['9:16']={subtitles:{style:{bottom:0.2}}};fs.writeFileSync(file,JSON.stringify(film));
  ctx=loadFilm(dir,{aspect:'9:16',requireShots:false});assert.equal(ctx.style.subtitles.bottom,0.2);
 } finally {if(old===undefined) delete process.env.WKA_NO_FONT_DOWNLOAD;else process.env.WKA_NO_FONT_DOWNLOAD=old;fs.rmSync(dir,{recursive:true,force:true});}
});
