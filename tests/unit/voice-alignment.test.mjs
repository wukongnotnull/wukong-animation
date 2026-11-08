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

test('本地 CLI 只接收本地 WAV/模型和 JSON 参数，失败不覆盖有效定位', {skip: process.platform === 'win32' ? '可执行夹具使用 POSIX shebang；Windows 需独立原生验证' : false}, async t=>{
 const {dir}=fixture(t),tool=path.join(dir,'local recognizer'),model=path.join(dir,'local model.bin');
 fs.writeFileSync(model,'contract fixture, not an actual model');
 const program=`#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);if(args.includes('--help'))process.exit(0);const prefix=args[args.indexOf('-of')+1];fs.writeFileSync(prefix+'.json',JSON.stringify({args,transcription:[{text:'你好',offsets:{from:0,to:1000},tokens:[{text:'你好',p:.99}]},{text:'世界',offsets:{from:1000,to:2000},tokens:[{text:'世界',p:.99}]}]}));`;
 fs.writeFileSync(tool,program,{mode:0o700});
 const {alignVoice}=await import('../../plugin/engine/audio/voice-alignment.mjs');
 const result=await alignVoice(dir,{binary:tool,model,log(){}});assert.equal(result.ready,true);
 const record=path.join(dir,'.wka/voice-alignment.json'),before=fs.readFileSync(record),saved=JSON.parse(before).voices.user;
 assert.equal(saved.method,'local-recognition-text-match');assert.ok(saved.evidence.args.includes('--no-gpu'));assert.ok(saved.evidence.args.includes('-ojf'));
 assert.equal(saved.evidence.args.includes('--prompt'),false);assert.equal(saved.evidence.args.some(a=>/srt|vtt/.test(a)),false);
 assert.equal(fs.readdirSync(dir,{recursive:true}).some(f=>/\.(srt|vtt)$/.test(f)),false);
 fs.writeFileSync(tool,`#!${process.execPath}\nif(process.argv.includes('--help'))process.exit(0);process.stderr.write('controlled failure');process.exit(2);`);
 await assert.rejects(()=>alignVoice(dir,{force:true,log(){}}),/controlled failure/);assert.deepEqual(fs.readFileSync(record),before);
});

test('更换一段原稿只让该录音定位过期，其他录音结果仍可复用',t=>{
 const {dir,film}=fixture(t);fs.copyFileSync(path.join(dir,'原声.wav'),path.join(dir,'第二段.wav'));film.audio.voices.push({cue:'second',file:'第二段.wav',at:2,text:'另一句'});fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(film));
 const status=voiceAlignmentStatus(dir);importVoiceTiming(dir,{version:1,voices:Object.fromEntries(Object.entries(status.voices).map(([id,v])=>[id,{source:v.source,segments:[{text:v.source.text,start:0,end:2}]}]))},{confirmation:'用户确认两段时间'});
 film.audio.voices[0].text='改过原稿';fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(film));const next=voiceAlignmentStatus(dir);
 assert.equal(next.voices.user.status,'stale');assert.equal(next.voices.second.status,'confirmed');
});

test('定位记录损坏不可当作可用；写入中断后重试恢复 cue 且不丢手工标记',t=>{
 const {dir}=fixture(t),source=voiceAlignmentStatus(dir).voices.user.source;
 importVoiceTiming(dir,{version:1,voices:{user:{source,segments:[{text:'你好世界',start:0,end:2}]}}},{confirmation:'测试用户确认'});
 const record=path.join(dir,'.wka/voice-alignment.json'),original=fs.readFileSync(record),bad=JSON.parse(original);
 bad.voices.user.segments[0].end=99;fs.writeFileSync(record,JSON.stringify(bad));assert.throws(()=>voiceAlignmentStatus(dir),/范围|定位|时间/);fs.writeFileSync(record,original);
 const filmFile=path.join(dir,'film.json'),film=JSON.parse(fs.readFileSync(filmFile));film.cues={manual:[0,.2]};fs.writeFileSync(filmFile,JSON.stringify(film));
 const rename=fs.renameSync;let failed=false;
 const mock=t.mock.method(fs,'renameSync',function(from,to){if(to===record&&!failed){failed=true;throw Error('模拟定位记录写入中断');}return rename.call(this,from,to);});
 assert.throws(()=>applyVoiceAlignment(dir),/模拟定位/);mock.mock.restore();
 applyVoiceAlignment(dir);assert.equal(failed,true);
 const saved=JSON.parse(fs.readFileSync(filmFile));assert.deepEqual(saved.cues.manual,[0,.2]);assert.deepEqual(saved.cues['speech:user:1'],[1,3]);
 const corrupt=JSON.parse(fs.readFileSync(record));corrupt.ownedCues.push('manual');fs.writeFileSync(record,JSON.stringify(corrupt));
 assert.throws(()=>applyVoiceAlignment(dir),/定位记录/);assert.deepEqual(JSON.parse(fs.readFileSync(filmFile)).cues.manual,[0,.2]);
});

test('修改已确认句段后必须重新应用到制作输入，旧画面不能直接沿用新定位签批',t=>{
 const {dir}=fixture(t),source=voiceAlignmentStatus(dir).voices.user.source;
 const input={version:1,voices:{user:{source,segments:[{text:'你好世界',start:0,end:2}]}}};
 importVoiceTiming(dir,input,{confirmation:'第一次听审'});assert.equal(voiceAlignmentStatus(dir).applied,false);
 applyVoiceAlignment(dir);assert.equal(voiceAlignmentStatus(dir).applied,true);
 input.voices.user.segments=[{text:'你好',start:0,end:.8},{text:'世界',start:.8,end:2}];
 importVoiceTiming(dir,input,{confirmation:'修正句段时间'});assert.equal(voiceAlignmentStatus(dir).ready,true);assert.equal(voiceAlignmentStatus(dir).applied,false);
 applyVoiceAlignment(dir);assert.equal(voiceAlignmentStatus(dir).applied,true);
});
