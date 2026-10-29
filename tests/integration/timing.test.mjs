import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WKA = fileURLToPath(new URL('../../plugin/engine/bin/wka.mjs', import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-timing-home-'));
for (const pipeline of ['browser', 'remotion']) {
  const dir = path.join(home, 'styles', 'timing-' + pipeline);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'style.json'), JSON.stringify({ id: 'timing-' + pipeline, name: '时间测试', category: 'xinxi', order: 999, engine: '>=0.1.0', pipeline, kits: {}, fps: 30, aspects: ['16:9','9:16'], keywords: ['test'] }));
}
const cli = (...args) => spawnSync(process.execPath, [WKA, ...args], { encoding: 'utf8', maxBuffer: 8e6, env: { ...process.env, WUKONG_ANIMATION_HOME: home, WKA_NO_FONT_DOWNLOAD: '1' } });
function film(pipeline, count = 3, duration = 0.34, fps = 10) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-时间 空格-'));
  fs.mkdirSync(path.join(dir, 'shots'));
  const shots = Array.from({ length: count }, (_, i) => {
    const id = 's' + String(i + 1).padStart(2,'0');
    const color = i % 2 ? '#ffffff' : '#000000';
    const ext = pipeline === 'browser' ? 'js' : 'tsx';
    const source = pipeline === 'browser'
      ? `wk.shot({render(ctx,t,s){ctx.fillStyle='${color}';ctx.fillRect(0,0,s.W,s.H);ctx.fillStyle='${i%2?'#000000':'#ffffff'}';ctx.fillRect(0,0,2,2);}});`
      : `import React from 'react';import {AbsoluteFill} from 'remotion';export default function Shot(){return <AbsoluteFill style={{background:'${color}'}}><div style={{width:2,height:2,background:'${i%2?'#000000':'#ffffff'}'}}/></AbsoluteFill>;}`;
    fs.writeFileSync(path.join(dir, 'shots', id + '.' + ext), source);
    return { id, file: 'shots/' + id + '.' + ext, duration };
  });
  fs.writeFileSync(path.join(dir,'film.json'), JSON.stringify({title:'时序', style:'timing-' + pipeline, size:[32,18],fps,seed:1,shots,variants:{'9:16':{}}}));
  return dir;
}
function frames(file) {
  const p = spawnSync('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames','-of','json',file],{encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);
  return Number(JSON.parse(p.stdout).streams[0].nb_read_frames);
}
function checkBoundaries(file, durations, fps) {
  const p = spawnSync('ffmpeg',['-v','error','-i',file,'-vf','scale=1:1','-f','rawvideo','-pix_fmt','gray','-'],{maxBuffer:8e6});
  assert.equal(p.status,0,String(p.stderr));
  let time = 0, start = 0;
  durations.forEach((duration,i) => {
    time += duration;
    const end = Math.round(time*fps);
    for (const index of [start,end-1]) assert.ok(i%2 ? p.stdout[index]>230 : p.stdout[index]<25, `镜${i+1}切点${index}错误：${p.stdout[index]}`);
    start = end;
  });
  assert.equal(p.stdout.length, Math.round(time*fps));
}

for (const pipeline of ['browser','remotion']) test(`${pipeline} 真渲染累计切点、代理帧数和来源验证`, {timeout:300000}, () => {
  const dir = film(pipeline);
  try {
    const original = fs.readFileSync(path.join(dir,'film.json'));
    for (const proxy of [false,true]) {
      const r = cli('render',dir,...(proxy?['--proxy']:[]));
      assert.equal(r.status,0,r.stderr);
      const file = path.join(dir,'.cache',proxy?'video-proxy.mp4':'video.mp4');
      const fps = proxy?5:10;
      assert.equal(frames(file), Math.round(1.02*fps));
      checkBoundaries(file,[0.34,0.34,0.34],fps);
      assert.ok(fs.existsSync(path.join(dir,'.cache',proxy?'timing-proxy.json':'timing.json')));
      const again = cli('render',dir,...(proxy?['--proxy']:[]));
      assert.equal(again.status,0,again.stderr);
      assert.match(again.stdout,/s01 缓存命中/);
    }
    assert.deepEqual(fs.readFileSync(path.join(dir,'film.json')),original);
    const bad = cli('qc',dir);
    assert.equal(bad.status,0,bad.stderr + bad.stdout);
    const video = path.join(dir,'.cache','video.mp4');
    fs.appendFileSync(video,'tamper');
    const qc = cli('qc',dir);
    assert.equal(qc.status,2,qc.stderr + qc.stdout);
    assert.match(qc.stdout,/拼接视频已变化/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

if (process.env.WKA_TIMING_LONG) for (const pipeline of ['browser','remotion']) test(`${pipeline} 107镜横竖高清与小样实测`, {timeout:1800000}, () => {
  const dir = film(pipeline,107,1.02,30);
  try {
    for (const aspect of [null,'9:16']) for (const proxy of [false,true]) {
      const r = cli('render',dir,...(aspect?['--aspect',aspect]:[]),...(proxy?['--proxy']:[]));
      assert.equal(r.status,0,r.stderr);
      const file = path.join(dir,'.cache',...(aspect?['9x16']:[]),proxy?'video-proxy.mp4':'video.mp4');
      assert.equal(frames(file),proxy?1637:3274);
      checkBoundaries(file,Array(107).fill(1.02),proxy?15:30);
    }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
