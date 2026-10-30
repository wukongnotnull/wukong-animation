import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outputSize } from '../../plugin/engine/core/job.mjs';
import { buildEntry } from '../../plugin/engine/pipelines/remotion/entry.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('小样限制为长边960/15fps，保持画幅、不放大，终稿原规格', () => {
  for (const [size, fps, expected] of [
    [[3840,2160],60,{W:960,H:540,fps:15}],
    [[1080,1920],30,{W:540,H:960,fps:15}],
    [[1080,1080],24,{W:960,H:960,fps:15}],
    [[320,180],10,{W:320,H:180,fps:10}],
  ]) {
    assert.deepEqual(outputSize({size,fps},true),expected);
    assert.deepEqual(outputSize({size,fps}),{W:size[0],H:size[1],fps});
  }
});

test('成功检查按内容跨进程复用，完整检查重测，损坏媒体/证据不通过', async () => {
  const timing=await import('../../plugin/engine/core/timing.mjs');
  assert.equal(typeof timing.checkedVideo,'function','需要内容寻址的媒体检查');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-validation-cache-'));
  const file=path.join(dir,'clip.mp4'), cacheDir=path.join(dir,'cache');
  const make=frames=>{
    const r=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=red:s=16x16:r=15','-frames:v',String(frames),file]);
    assert.equal(r.status,0,String(r.stderr));
  };
  const child=(fresh=false,target=file)=>{
    const module=pathToFileURL(path.resolve('plugin/engine/core/timing.mjs')).href;
    const r=spawnSync(process.execPath,['--input-type=module','-e',`import {checkedVideo} from ${JSON.stringify(module)}; console.log(JSON.stringify(checkedVideo(${JSON.stringify(target)},{fps:15,frames:15},{cacheDir:${JSON.stringify(cacheDir)},fresh:${fresh}})))`],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
  };
  try {
    make(15);
    const first=child();assert.equal(first.ok,true);assert.equal(first.reused,false);
    const reuse=child();assert.equal(reuse.reused,'disk');assert.equal(reuse.measuredAt,first.measuredAt);
    assert.equal(child(true).reused,false,'完整检查不能沿用上次调用');
    const proof=fs.readdirSync(path.join(cacheDir,'video-checks'))[0];
    fs.writeFileSync(path.join(cacheDir,'video-checks',proof),'{broken');
    assert.equal(child().reused,false,'坏证据重新检查');
    timing.checkedVideo(file,{fps:15,frames:15},{cacheDir,fresh:true});
    const copy=path.join(dir,'copied.mp4');fs.copyFileSync(file,copy);
    assert.equal(timing.checkedVideo(copy,{fps:15,frames:15},{cacheDir}).reused,'session');
    assert.equal(child(false,copy).reused,'disk','改名或复制的已检查媒体也要持久化证据');
    make(14);assert.equal(child().ok,false,'修改内容重新检查');
    fs.writeFileSync(file,'not a video');assert.equal(child().ok,false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('Remotion直接按小样时间轴生成帧，长片切点不漂移', () => {
  const job={film:{fps:60},fps:15,designW:1920,designH:1080,seed:1,
    shots:Array.from({length:107},(_,i)=>({id:`s${i}`,path:'/shot.tsx',duration:1.02,start:i*1.02}))};
  const shots=JSON.parse(buildEntry(job,'').match(/const SHOTS = (.*);\n/)[1]);
  assert.equal(shots.reduce((n,s)=>n+s.frames,0),1637);
  assert.ok(shots.every(s=>s.s.fps===15));
});

test('局部Remotion入口沿用整片分配的帧，不重新舍入短镜头', () => {
  const job={film:{fps:30},fps:15,designW:320,designH:180,shots:[{id:'s02',path:'/s02.tsx',duration:0.02,start:0.3,frames:1}]};
  const shots=JSON.parse(buildEntry(job,'').match(/const SHOTS = (.*);\n/)[1]);
  assert.equal(shots[0].frames,1);
});
