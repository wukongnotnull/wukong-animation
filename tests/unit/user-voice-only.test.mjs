import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planVoiceLines } from '../../plugin/engine/audio/soundtrack.mjs';
import { buildDraftPlan } from '../../plugin/engine/exporters/jianying/plan.mjs';
test('人声只接受用户录音，缺少素材不会退回 AI 或估算',()=>{
 assert.throws(()=>planVoiceLines({voice_source:'ai',voices:[{text:'台词',at:0}]}),/用户.*录音|AI/);
 assert.throws(()=>planVoiceLines({voice_source:'user',voices:[]}),/录音/);
 assert.throws(()=>planVoiceLines({voices:[{text:'台词',at:0}]}),/录音/);
 assert.deepEqual(planVoiceLines({}).lines,[]);
 assert.equal(planVoiceLines({voice_source:'user',voices:[{file:'whole.wav',at:0}]}).lines[0].via,'recording');
});
test('剪映计划不把台词或录音自动转换为字幕',()=>{
 const timeline={title:'片',size:[160,90],fps:10,duration:1,shots:[{id:'s01',file:'s01.mp4',start:0,duration:1}],tracks:[],voices:[{text:'只供对齐',at:0,duration:1}]};
 const plan=buildDraftPlan(timeline);assert.deepEqual(plan.subtitleTracks,[]);
 assert.throws(()=>buildDraftPlan({...timeline,subtitles:[{text:'旧字幕',start:0,end:1}]}),/字幕/);
});
