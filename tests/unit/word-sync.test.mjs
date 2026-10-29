import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const word = await import('../../plugin/engine/core/word-sync.mjs').catch(() => ({}));
test('来源绑定、重复词选择、过期测量回退和整体平移', () => {
  assert.equal(typeof word.resolveWordSync,'function','缺少词级来源解析');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-word-'));
  try {
    fs.writeFileSync(path.join(dir,'voice.wav'),'actual voice bytes');
    const film={audio:{voice_source:'user',voices:[{cue:'v01',text:'有素材，无素材，有素材',at:1,file:'voice.wav'}]},cues:{v01:[1,4]}};
    const ctx={filmDir:dir,film};
    word.writeVoiceSources(ctx,[{file:path.join(dir,'voice.wav'),duration:3}]);
    const source=JSON.parse(fs.readFileSync(path.join(dir,'.cache','voice-sources.json'))).voices.v01;
    const point={id:'materials',voice:'v01',text:'有素材',occurrence:2,method:'manual',source:{audio_sha256:source.audio_sha256,text_sha256:source.text_sha256},range:[2,2.5],evidence:'听审标注'};
    fs.writeFileSync(path.join(dir,'sync-points.json'),JSON.stringify({version:1,points:[point]}));
    let result=word.resolveWordSync(ctx);
    assert.deepEqual(result.cues['word:materials'],[3,3.5]);
    assert.equal(result.evidence['word:materials'].verified,true);
    film.audio.voices[0].at=2;
    assert.deepEqual(word.resolveWordSync(ctx).cues['word:materials'],[4,4.5]);
    assert.equal(word.resolveWordSync(ctx).evidence['word:materials'].verified,false,'混音未刷新时不能宣称通过');
    word.writeVoiceSources(ctx,[{file:path.join(dir,'voice.wav'),duration:3}]);
    assert.equal(word.resolveWordSync(ctx).evidence['word:materials'].verified,true);
    fs.writeFileSync(path.join(dir,'voice.wav'),'new audio');
    result=word.resolveWordSync(ctx);
    assert.equal(result.evidence['word:materials'].verified,false);
    assert.equal(result.evidence['word:materials'].method,'estimated');
    assert.notDeepEqual(result.cues['word:materials'],[4,4.5]);
    delete point.occurrence;
    fs.writeFileSync(path.join(dir,'sync-points.json'),JSON.stringify({version:1,points:[point]}));
    assert.throws(()=>word.resolveWordSync(ctx),/occurrence/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('词首帧映射符合降帧采样；越界不静默夹取',()=>{
  assert.equal(typeof word.wordFrame,'function');
  for(const [nativeFps,outputFps] of [[30,30],[30,15],[25,13]]) {
    for(let target=0;target<10;target++) {
      const point={in:target/outputFps};
      const shot={startFrame:0,frames:10,nativeFrames:Math.ceil(10*nativeFps/outputFps),start:0,duration:10/outputFps};
      const r=word.wordFrame(point,shot,{fps:outputFps,nativeFps,remotion:true});
      assert.equal(r.valid,true);
      const samples=Array.from({length:10},(_,j)=>Math.min(shot.nativeFrames-1,Math.ceil((j+0.5)*nativeFps/outputFps)-1));
      assert.equal(samples.findIndex(f=>f>=r.frame),target);
    }
  }
  assert.equal(word.wordFrame({in:-1},{startFrame:0,frames:30,nativeFrames:30},{fps:30,nativeFps:30}).valid,false);
});

test('错误声明、估算分级、音色变化、无关配乐与来源清理',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-word-validation-'));
 try {
  assert.deepEqual(word.resolveWordSync({filmDir:dir,film:{}}).points,[]);
  fs.writeFileSync(path.join(dir,'voice.wav'),'voice content');
  const line={cue:'v01',text:'𠮷有素材',at:0,file:'voice.wav'};
  const ctx={filmDir:dir,film:{audio:{voice_source:'user',voices:[line]},cues:{}}};
  word.writeVoiceSources(ctx,[{file:path.join(dir,'voice.wav'),duration:1}]);
  const src=JSON.parse(fs.readFileSync(path.join(dir,'.cache','voice-sources.json'))).voices.v01;
  const point={id:'unicode',voice:'v01',text:'有素材',method:'manual',source:{audio_sha256:src.audio_sha256,text_sha256:src.text_sha256},range:[0.2,0.8],evidence:'听审'};
  const put=p=>fs.writeFileSync(path.join(dir,'sync-points.json'),JSON.stringify({version:1,points:Array.isArray(p)?p:[p]}));put(point);
  let r=word.resolveWordSync(ctx);assert.equal(r.evidence['word:unicode'].verified,true);
  ctx.film.audio.tracks=[{file:'bgm.wav'}];assert.equal(word.resolveWordSync(ctx).evidence['word:unicode'].verified,true);
  line.voice='different';assert.equal(word.resolveWordSync(ctx).evidence['word:unicode'].verified,false);delete line.voice;
  put({...point,range:[0.5,1.2]});assert.throws(()=>word.resolveWordSync(ctx),/超出/);
  put({...point,source:undefined});assert.throws(()=>word.resolveWordSync(ctx),/缺少/);
  put([point,point]);assert.throws(()=>word.resolveWordSync(ctx),/重复/);
  put({...point,text:'不存在'});assert.throws(()=>word.resolveWordSync(ctx),/不存在/);
  put({...point,method:'estimated',range:undefined,source:undefined});assert.equal(word.resolveWordSync(ctx).evidence['word:unicode'].verified,false);
  ctx.film.audio.voices=[];word.writeVoiceSources(ctx,[]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'.cache','voice-sources.json'))).voices,{});
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
