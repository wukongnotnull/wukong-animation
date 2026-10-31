import test from 'node:test';
import assert from 'node:assert/strict';
const load=()=>import('../../tools/merge-gate.mjs');
test('gate policy exists',async()=>{assert.ok(await load().catch(()=>null),'merge gate policy is missing');});
for(const files of [['README.md'],['docs/guide.md'],['docs/guide.mjs'],['plugin/skills/setup/SKILL.md'],['.github/workflows/smoke.yml'],['README.md','plugin/engine/core/job.mjs'],[]])test('classifies '+JSON.stringify(files),async()=>{
 const {documentationOnly}=await load();assert.equal(documentationOnly(files),files.length>0&&files.every(f=>f==='README.md'||f==='docs/guide.md'));
});
for(const result of ['failure','cancelled','skipped','',undefined])test('rejects '+result,async()=>{
 const {gatePassed}=await load();assert.equal(gatePassed(false,{lint:'success',installation:'success',jianying:'success',smoke:result}),false);
});
test('requires all real checks and only permits classified media skip',async()=>{
 const {gatePassed}=await load();const ok={lint:'success',installation:'success',jianying:'success',smoke:'success'};
 assert.equal(gatePassed(false,ok),true);assert.equal(gatePassed(true,{...ok,smoke:'skipped'}),true);assert.equal(gatePassed(true,{...ok,jianying:'skipped'}),false);
});
