import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../../plugin/engine/core/ffmpeg.mjs';
import { burnSubtitles } from '../../plugin/engine/core/subtitle-layer.mjs';
import { planPresenterSubtitles } from '../../plugin/engine/core/subtitles.mjs';
import { buildFrameTimeline } from '../../plugin/engine/core/timing.mjs';
import { checkPresenterOutput, presenterVerdict } from '../../plugin/engine/core/presenter-subtitles.mjs';

test('检查最终 MP4 首中末帧并抓到实际漏字', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'wka-captions-'));
  try {
    const [clean,good,bad,layer] = ['clean.mp4','good.mp4','bad.mp4','layer.png'].map(f=>path.join(dir,f));
    const W = 160, H = 96, fps = 10;
    await run(['-f','lavfi','-i','color=c=0x263448:s=160x96:r=10:d=2','-c:v','libx264','-pix_fmt','yuv420p',clean]);
    await run(['-f','lavfi','-i','color=black@0.0:s=160x96,format=rgba,drawbox=x=35:y=62:w=90:h=14:color=white:t=fill:replace=1','-frames:v','1','-update','1',layer]);
    const subs = [{index:1,start:.2,end:.8,text:'一句'},{index:2,start:1.2,end:1.8,text:'又一句'}];
    const timeline = buildFrameTimeline([{id:'s01',duration:1},{id:'s02',duration:1}],fps);
    const plan = planPresenterSubtitles(subs,timeline,[]);
    const options = {W,H,fps,presenterFrames:timeline.totalFrames,workDir:dir,log:()=>{}};
    await burnSubtitles(clean,subs,good,{...options,prepared:{files:[layer,layer]}});
    await burnSubtitles(clean,[{...subs[0],start:.3}],bad,{...options,prepared:{files:[layer]}});
    const verify = file=>checkPresenterOutput({clean,file,plan,layers:[layer,layer],W,H});
    const shown = await verify(good);
    assert.deepEqual(shown.map(s=>s.status),Array(6).fill('visible'));
    const missing = await verify(bad);
    assert.deepEqual(missing.filter(s=>s.status==='missing').map(s=>[s.index,s.frame]),[[1,2],[2,12],[2,15],[2,17]]);
    assert.equal(presenterVerdict(missing,'proof','proof'),'missing');
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

for (const [label,size,flags,ending] of [
  ['横屏正式版',[320,180],[],''],
  ['竖屏小样',[180,320],['--proxy'],'-proxy'],
]) test(`wka final 从主播 SRT 核验${label} MP4`, async () => {
  const { runCli } = await import('../../plugin/engine/cli/run.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-presenter-final-'));
  const messages=[];
  const cli=(...args)=>runCli(args,{log:(...args)=>messages.push(args.join(' ')),error:(...args)=>messages.push(args.join(' '))});
  try {
    fs.writeFileSync(path.join(dir,'shot.js'),"wk.shot({render(ctx,t,s){ctx.fillStyle='#1d2640';ctx.fillRect(0,0,s.W,s.H)}});");
    fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify({
      title:'Presenter',style:'ink-wash',size,fps:10,seed:1,
      shots:[{id:'s01',file:'shot.js',duration:2}],
      subtitles:{mode:'burn',source:'presenter',file:'host.srt',blank_ranges:[{start:1,end:2}]},
      export:{formats:['mp4'],name:'final'},
    }));
    const srt='1\n00:00:00,200 --> 00:00:00,800\nPresenter\n';
    assert.equal(await cli('subtitles',dir),1);
    assert.match(messages.at(-1),/缺少主播实录 SRT/);
    fs.writeFileSync(path.join(dir,'host.srt'),srt);
    assert.equal(await cli('subtitles',dir,'--force'),0,messages.join('\n'));
    assert.equal(fs.readFileSync(path.join(dir,'host.srt'),'utf8'),srt);
    assert.equal(await cli('final',dir,...flags),0,messages.join('\n'));
    const report=JSON.parse(fs.readFileSync(path.join(dir,'review',`主播字幕成片核验${ending}.json`),'utf8'));
    assert.equal(report.file,path.join(dir,`final_有字幕${ending}.mp4`));
    assert.equal(report.verdict,'visible');
    assert.deepEqual(report.samples.map(s=>s.frame),[2,5,7]);
    if (!ending) {
      const delivery=JSON.parse(fs.readFileSync(path.join(dir,'.wka','final-delivery.json'),'utf8'));
      assert.match(delivery.artifacts.at(-1).technical.checks.join('\n'),/首中末帧核验/);
    }
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
