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
test('CLI classifies renamed code as a code change',async()=>{
 const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');const {execFileSync}=await import('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-gate-'));const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'});
 try{
 git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
 fs.mkdirSync(path.join(dir,'plugin'));fs.writeFileSync(path.join(dir,'plugin/code.mjs'),'// source\n');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD').trim();
 fs.mkdirSync(path.join(dir,'docs'));git('mv','plugin/code.mjs','docs/code.md');git('commit','-qm','rename');const head=git('rev-parse','HEAD').trim();
 const cli=new URL('../../tools/merge-gate.mjs',import.meta.url);assert.equal(execFileSync(process.execPath,[(await import('node:url')).fileURLToPath(cli),'classify',base,head],{cwd:dir,encoding:'utf8'}).trim(),'docs=false');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
