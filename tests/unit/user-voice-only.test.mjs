import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planVoiceLines } from '../../plugin/engine/audio/soundtrack.mjs';
import { buildDraftPlan } from '../../plugin/engine/exporters/jianying/plan.mjs';
test('人声只接受用户录音，缺少素材不会退回 AI 或估算',()=>{
 assert.throws(()=>planVoiceLines({voice_source:'ai',voices:[{text:'台词',at:0}]}),/用户.*录音|AI/);
 assert.throws(()=>planVoiceLines({voice_source:'user',voices:[]}),/录音/);
 assert.throws(()=>planVoiceLines({voices:[{text:'台词',at:0}]}),/录音/);
 assert.deepEqual(planVoiceLines({}).lines,[]);
 assert.equal(planVoiceLines({voice_source:'user',voices:[{file:'whole.wav',at:0}]}).lines[0].via,'recording');
});
test('人声规范区分录音内定位与全片编排，并保留冲突决策', () => {
 const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
 const local = read('plugin/skills/director/references/LOCAL-SPEECH.md');
 const voice = read('plugin/skills/director/specs/VOICE.md');
 assert.match(local, /录音内.*时间/);
 assert.match(local, /不依赖.*shots.*片长/);
 assert.match(local, /at.*全片.*句段.*词.*cue.*不.*返审人声/);
 assert.match(voice, /confirmed.*applied/);
 assert.match(voice, /pending.*不.*镜头引用/);
 assert.match(voice, /重录.*修改剧本.*重新确认/);
 assert.match(voice, /完整录音.*实长/);
 assert.match(voice, /内部节奏.*语义定位.*返审人声/);
 for (const file of ['README.md', 'plugin/skills/film/SKILL.md', 'docs/WORKBENCH.md']) {
  assert.match(read(file), /9 道工序.*最多 8 个审片节点/);
 }
 assert.doesNotMatch(read('README.md'), /也可以用 AI 配音/);
});

test('剪映计划不把台词或录音自动转换为字幕',()=>{
 const timeline={title:'片',size:[160,90],fps:10,duration:1,shots:[{id:'s01',file:'s01.mp4',start:0,duration:1}],tracks:[],voices:[{text:'只供对齐',at:0,duration:1}]};
 const plan=buildDraftPlan(timeline);assert.deepEqual(plan.subtitleTracks,[]);
 assert.throws(()=>buildDraftPlan({...timeline,subtitles:[{text:'旧字幕',start:0,end:1}]}),/字幕/);
});
