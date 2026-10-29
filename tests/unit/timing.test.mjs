import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrameTimeline } from '../../plugin/engine/core/timing.mjs';

test('累计帧数与所有切点误差有界，包括奇数帧率', () => {
  for (const fps of [12, 15, 24, 25, 29, 30, 60, 120]) {
    const shots = Array.from({ length: 107 }, (_, i) => ({ id: `s${i}`, duration: i % 2 ? 0.73 : 1.02 }));
    const original = JSON.stringify(shots);
    const t = buildFrameTimeline(shots, fps);
    let seconds = 0;
    for (const s of t.shots) {
      seconds += s.plannedDuration;
      assert.equal(s.endFrame, Math.round(seconds * fps));
      assert.ok(Math.abs(s.endFrame / fps - seconds) <= 0.5 / fps + 1e-10);
    }
    assert.equal(t.totalFrames, Math.round(seconds * fps));
    assert.equal(JSON.stringify(shots), original);
  }
});

test('107×1.02s：高清3274帧，小样1637帧', () => {
  const shots = Array.from({ length: 107 }, (_, i) => ({ id: `s${i}`, duration: 1.02 }));
  assert.equal(buildFrameTimeline(shots, 30).totalFrames, 3274);
  assert.equal(buildFrameTimeline(shots, 15).totalFrames, 1637);
});

test('整数帧镜长不变；低帧率零帧拒绝，不静默补帧', () => {
  assert.deepEqual(buildFrameTimeline([{ id: 's01', duration: 1 }, { id: 's02', duration: 2 }], 30).shots.map(s => s.frames), [30, 60]);
  assert.throws(() => buildFrameTimeline([{ id: 's01', duration: 0.1 }], 1), /s01.*0.1s.*1fps/);
  assert.equal(buildFrameTimeline([{ id: 's01', duration: 0.1 }], 30).totalFrames, 3);
  assert.throws(() => buildFrameTimeline([], 29.97), /整数/);
});

test('真实媒体检查拒绝错误帧数，即使容器时长看起来正常', async () => {
  const timing = await import('../../plugin/engine/core/timing.mjs');
  assert.equal(typeof timing.inspectVideo, 'function', '缺少真实媒体检查');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'wka-timing-unit-'));
  try {
    const file = join(dir, 'clip.mp4');
    const r = spawnSync('ffmpeg', ['-v','error','-y','-f','lavfi','-i','color=c=red:s=16x16:r=30','-frames:v','31',file]);
    assert.equal(r.status, 0, String(r.stderr));
    assert.equal(timing.inspectVideo(file, { fps: 30, frames: 31 }).ok, true);
    const bad = timing.inspectVideo(file, { fps: 30, frames: 30 });
    assert.equal(bad.ok, false);
    assert.match(bad.errors.join(' '), /31.*30/);
    assert.equal(timing.inspectVideo(file, { fps: 15, frames: 31 }).ok, false);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});

test('中间正负偏差抵消、截短输出和来源过期都不能通过', async () => {
  const { recordTiming, checkTiming, checkOutputTiming } = await import('../../plugin/engine/core/timing.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'wka-timing-cancel-'));
  const ctx = {filmDir:dir, film:{fps:10,shots:[{id:'s01',duration:1},{id:'s02',duration:1}]},variant:{aspect:'16:9',cacheDir:path.join(dir,'.cache')}};
  ctx.shots = ctx.film.shots;
  const make = (name, frames) => {
    const file = path.join(dir,name);
    const r = spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=red:s=16x16:r=10','-frames:v',String(frames),file]);
    assert.equal(r.status,0,String(r.stderr));
    return file;
  };
  try {
    assert.equal(checkTiming(ctx).ok,false,'没有来源记录不得通过');
    const a = make('a.mp4',11), b = make('b.mp4',9), video=make('video.mp4',20);
    assert.throws(() => recordTiming(ctx,video,[a,b]), /时间轴检查失败/);
    const report = JSON.parse(fs.readFileSync(path.join(dir,'review','时间轴检查.json')));
    assert.equal(report.video.frames,20,'总帧数其实正确');
    assert.match(report.errors.join(' '),/s01 切点实测 11 帧，期望 10/);
    assert.equal(fs.existsSync(path.join(dir,'.cache','timing.json')),false);
    make('a.mp4',10); make('b.mp4',10);
    recordTiming(ctx,video,[a,b]);
    assert.equal(checkTiming(ctx).ok,true);
    const {encodeOutput} = await import('../../plugin/engine/exporters/mp4/index.mjs');
    const audio = path.join(dir,'short.wav');
    const sound = spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','0.1',audio]);
    assert.equal(sound.status,0,String(sound.stderr));
    const out = path.join(dir,'short.mp4');
    await encodeOutput({video,audio,out});
    assert.throws(() => checkOutputTiming(ctx,out),/声轨是否过短/);
    assert.equal(checkTiming(ctx).ok,false,'失败输出不能在后续QC中消失');
    recordTiming(ctx,video,[a,b]);
    const exported=make('exported.mp4',20);
    checkOutputTiming(ctx,exported);
    make('exported.mp4',19);
    assert.equal(checkTiming(ctx).ok,false,'输出被截短后不能沿用旧的通过结论');
    recordTiming(ctx,video,[a,b]);
    ctx.film.shots[0].duration=1.1;
    assert.match(checkTiming(ctx).errors.join(' '),/过期/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('拼接消除微秒时长累积的PTS误差，保持全部视频帧', async () => {
  const media = await import('../../plugin/engine/core/ffmpeg.mjs');
  assert.equal(typeof media.concatVideo,'function','缺少保留帧数的拼接时间戳量化');
  const { inspectVideo } = await import('../../plugin/engine/core/timing.mjs');
  const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
  const {spawnSync}=await import('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-concat-pts-'));
  try {
    const clip=path.join(dir,'clip.mp4');
    const r=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=red:s=16x16:r=30','-frames:v','31','-video_track_timescale','90000','-movie_timescale','90000',clip]);
    assert.equal(r.status,0,String(r.stderr));
    const out=path.join(dir,'out.mp4');
    await media.concatVideo(Array(107).fill(clip),{fps:30,list:path.join(dir,'list.txt'),out});
    const result=inspectVideo(out,{fps:30,frames:3317});
    assert.equal(result.ok,true,result.errors.join('；'));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('不同B帧重排深度的短片段拼接仍保持CFR和片长',async()=>{
 const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os');
 const {spawnSync}=await import('node:child_process');
 const {concatVideo}=await import('../../plugin/engine/core/ffmpeg.mjs');
 const {inspectVideo}=await import('../../plugin/engine/core/timing.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-dts-reorder-'));
 try {
  const clips=[];
  for(const [i,frames,bf] of [[0,2,0],[1,41,3]]) {
   const file=path.join(dir,`${i}.mp4`);
   const r=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=red:s=16x16:r=13','-frames:v',String(frames),'-bf',String(bf),file]);assert.equal(r.status,0,String(r.stderr));clips.push(file);
  }
  const out=path.join(dir,'out.mp4');await concatVideo(clips,{fps:13,list:path.join(dir,'list.txt'),out});
  const r=inspectVideo(out,{fps:13,frames:43});assert.equal(r.ok,true,r.errors.join('；'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('半帧静音尾隙只用于引擎混音，原文件不变且更大缺失不补',async()=>{
 const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os');
 const {spawnSync}=await import('node:child_process');const {generatedMixPadding}=await import('../../plugin/engine/core/ffmpeg.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-mix-gap-'));fs.mkdirSync(path.join(dir,'.cache'));
 try {
  const mix=path.join(dir,'.cache','mix.wav');
  const r=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1',mix]);assert.equal(r.status,0,String(r.stderr));
  const before=fs.readFileSync(mix);
  assert.ok(generatedMixPadding(mix,1.02,15).includes('-af'));
  assert.deepEqual(generatedMixPadding(mix,1.2,15),[]);
  const raw=path.join(dir,'user.wav');fs.copyFileSync(mix,raw);assert.deepEqual(generatedMixPadding(raw,1.02,15),[]);
  assert.deepEqual(fs.readFileSync(mix),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
