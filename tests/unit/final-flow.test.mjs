import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { finalContract, finalDeliveryReport, prepareFinalApproval } from '../../plugin/engine/core/final-delivery.mjs';
import { loadFilm } from '../../plugin/engine/core/film-context.mjs';
function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-final-flow-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));initializeProduction(dir);
 const film={title:'新片',style:'ink-wash',size:[160,90],fps:10,seed:1,shots:[{id:'s01',file:'s01.js',duration:1}],audio:{voice_source:'none'},export:{formats:['mp4']}};
 const write=()=>fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(film));write();
 fs.writeFileSync(path.join(dir,'.wka/decisions.json'),JSON.stringify({version:1,delivery:{status:'confirmed',value:'video',source:'用户'},aspects:{status:'confirmed',value:['16:9'],source:'用户'}}));
 return {dir,film,write};
}
test('新成片不再要求字幕选择，仅提供无字幕视频，验收绑定 6/7/8',t=>{
 const {dir}=fixture(t),contract=finalContract(dir);assert.deepEqual(contract.errors,[]);assert.deepEqual(contract.slots.map(s=>s.slot),['16:9/video/mp4/clean']);
 const report=finalDeliveryReport(dir);assert.deepEqual(Object.keys(report.reviewSets).sort(),['6','7','8']);
 assert.throws(()=>prepareFinalApproval(dir,{step:13}),/6\/7\/8/);
});
test('新项目明确拒绝字幕和 AI 人声配置，不静默沿用旧能力',t=>{
 const {dir,film,write}=fixture(t);film.subtitles={mode:'burn'};write();assert.throws(()=>loadFilm(dir,{requireShots:false}),/字幕/);
 delete film.subtitles;film.audio={voice_source:'ai',voices:[{id:'v1',text:'人声',at:0}]};write();assert.throws(()=>loadFilm(dir,{requireShots:false}),/用户.*人声|AI 人声/);
});
