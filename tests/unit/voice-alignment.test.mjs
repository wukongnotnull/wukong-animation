import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { reconcileSegments, validateSegments, voiceAlignmentStatus, importVoiceTiming, applyVoiceAlignment } from '../../plugin/engine/audio/voice-alignment.mjs';
function wave(file) { const b=Buffer.alloc(44+32000*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);fs.writeFileSync(file,b); }
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'录音 定位 '));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));initializeProduction(dir);wave(path.join(dir,'原声.wav'));const film={title:'片',style:'ink-wash',size:[160,90],fps:10,seed:1,shots:[{id:'s01',file:'s01.js',duration:4}],audio:{voice_source:'user',voices:[{cue:'user',file:'原声.wav',at:1,text:'你好世界'}]}};fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(film));return {dir,film};}
test('真实识别句段保序对应原稿，重复、遗漏和低可信部分保持待确认',()=>{
 const rows=[{text:'你好',start:0,end:1,confidence:.95},{text:'世界',start:1,end:2,confidence:.95}];
 assert.equal(reconcileSegments(rows,'你好，世界！',2).status,'matched');
 assert.equal(reconcileSegments(rows,'你好宇宙',2).status,'pending');
 assert.equal(reconcileSegments([{...rows[0],confidence:.1}],'你好',2).status,'pending');
 assert.equal(reconcileSegments([{text:'你好',start:0,end:1,confidence:.9},{text:'你好',start:1,end:2,confidence:.9}],'你好你好',2).status,'pending');
 assert.equal(reconcileSegments(rows,'',2).method,'local-recognition');
});
test('无效、越界、倒序及无语音不可标成可用时间',()=>{
 for(const rows of [[{text:'甲',start:-1,end:1}],[{text:'甲',start:0,end:3}],[{text:'甲',start:1,end:1}],[{text:'甲',start:1,end:2},{text:'乙',start:.5,end:1}],[]]) assert.throws(()=>validateSegments(rows,2));
});
test('人工时间点必须确认并绑定当前录音，cue 不覆盖用户其他标记，源变化即过期',t=>{
 const {dir,film}=fixture(t),status=voiceAlignmentStatus(dir),source=status.voices.user.source;
 const input={version:1,voices:{user:{source,segments:[{text:'你好',start:0,end:1},{text:'世界',start:1,end:2}]}}};
 assert.throws(()=>importVoiceTiming(dir,input),/确认/);
 importVoiceTiming(dir,input,{confirmation:'用户已听审并确认这些时间点'});
 assert.equal(voiceAlignmentStatus(dir).voices.user.status,'confirmed');
 applyVoiceAlignment(dir);const saved=JSON.parse(fs.readFileSync(path.join(dir,'film.json')));assert.deepEqual(saved.cues['speech:user:1'],[1,2]);assert.deepEqual(saved.cues['speech:user:2'],[2,3]);
 saved.cues.manual=[0,.2];saved.audio.voices[0].at=0;fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(saved));
 assert.equal(voiceAlignmentStatus(dir).voices.user.status,'stale');assert.throws(()=>applyVoiceAlignment(dir),/过期|定位/);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'film.json'))).cues.manual,[0,.2]);
 assert.throws(()=>importVoiceTiming(dir,input,{confirmation:'同意'}),/来源|过期/);
 assert.equal(film.audio.voices.length,1);
});
