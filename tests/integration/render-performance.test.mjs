import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { check } from '../../plugin/engine/pipelines/browser/index.mjs';

const ready=(await check()).ok;
const wka=(...args)=>spawnSync(process.execPath,[path.resolve('plugin/engine/bin/wka.mjs'),...args],{encoding:'utf8',env:{...process.env,WKA_NO_FONT_DOWNLOAD:'1',WKA_WORKERS:'1'}});
const shot=color=>`wk.shot({render(ctx,t,s){ctx.fillStyle='${color}';ctx.fillRect(0,0,s.W,s.H);}});`;

test('日常预览只更新选定或变化的镜头，复用原片段，不拼接整片；清理保护声音和定稿', {skip:!ready,timeout:120000}, () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-local-preview-'));
  const run=(...args)=>{const r=wka(...args);assert.equal(r.status,0,r.stderr);return r;};
  try {
    fs.mkdirSync(path.join(dir,'shots'));
    fs.writeFileSync(path.join(dir,'shots/s01.js'),shot('red'));
    fs.writeFileSync(path.join(dir,'shots/s02.js'),shot('blue'));
    fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify({title:'preview',style:'ink-wash',size:[320,180],fps:30,seed:1,shots:[{id:'s01',file:'shots/s01.js',duration:0.4},{id:'s02',file:'shots/s02.js',duration:0.4}]}));
    run('preview',dir,'--only','s01');
    const manifest=()=>JSON.parse(fs.readFileSync(path.join(dir,'.cache/manifest.json'))).shots;
    assert.deepEqual(Object.keys(manifest()),['s01-proxy']);
    assert.equal(fs.existsSync(path.join(dir,'.cache/video-proxy.mp4')),false);
    assert.equal(fs.existsSync(path.join(dir,'.cache/timing-proxy.json')),false);
    assert.notEqual(wka('signoff',dir,'仅看过局部','--step','11').status,0,'局部预览不能代替完整小样验收');
    assert.ok(fs.existsSync(path.join(dir,'review/局部小样/s01.mp4')));
    const first=manifest()['s01-proxy'];
    run('preview',dir);
    assert.equal(manifest()['s01-proxy'].at,first.at);
    const second=manifest()['s02-proxy'];
    const reuse=run('preview',dir);
    assert.doesNotMatch(reuse.stdout,/渲染 \d+ 个镜头用时/);
    fs.writeFileSync(path.join(dir,'shots/s01.js'),shot('green'));
    run('preview',dir);
    assert.notEqual(manifest()['s01-proxy'].hash,first.hash);
    assert.equal(manifest()['s02-proxy'].at,second.at);
    assert.equal(fs.existsSync(first.file),false,'只保留最新小样');
    assert.notEqual(wka('preview',dir,'--only','missing').status,0);
    run('preview',dir,'--native','--only','s01');
    assert.ok(manifest().s01);assert.ok(manifest()['s01-proxy']);
    const mix=path.join(dir,'.cache/mix.wav');
    const sound=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=f=440:d=0.4','-af','apad=pad_dur=0.4',mix]);
    assert.equal(sound.status,0,String(sound.stderr));
    run('preview',dir,'--only','s02');
    const pcm=spawnSync('ffmpeg',['-v','error','-i',path.join(dir,'review/局部小样/s02.mp4'),'-map','0:a:0','-f','s16le','-ac','1','-ar','8000','-']);
    assert.equal(pcm.status,0,String(pcm.stderr));
    assert.ok(pcm.stdout.length>4000,'局部小样包含对应时段声轨');
    let peak=0;for(let i=0;i<pcm.stdout.length;i+=2) peak=Math.max(peak,Math.abs(pcm.stdout.readInt16LE(i)));
    assert.ok(peak<50,'s02对应静音段，不能错用s01的声音');
    for(const f of ['.cache/mix.wav','.cache/approved/s01.mp4','.wka/state.json','out.mp4','audio/voice.wav']) {
      fs.mkdirSync(path.dirname(path.join(dir,f)),{recursive:true});fs.writeFileSync(path.join(dir,f),'keep');
    }
    run('clean',dir,'--render-cache');
    assert.equal(fs.existsSync(path.join(dir,'.cache/segments')),false);
    for(const f of ['.cache/mix.wav','.cache/approved/s01.mp4','.wka/state.json','out.mp4','audio/voice.wav']) assert.equal(fs.readFileSync(path.join(dir,f),'utf8'),'keep');
    assert.notEqual(wka('clean',dir).status,0,'清理必须明确类型');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
