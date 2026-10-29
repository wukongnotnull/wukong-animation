import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const run=(file,args=[],options={})=>spawnSync(process.execPath,[path.join(ROOT,file),...args],{encoding:'utf8',...options});
const walk=(dir,prefix='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]);
test('portable bundle is closed, deterministic, movable and contains only one discoverable entry',t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wka portable 中 #% '));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const out=path.join(tmp,'release');
 let r=run('tools/build-portable.mjs',['--out',out]);assert.equal(r.status,0,r.stderr);
 const bundle=path.join(out,'wukong-animation'),files=walk(bundle);
 assert.deepEqual(files.filter(f=>path.basename(f)==='SKILL.md'),['SKILL.md']);
 assert.match(fs.readFileSync(path.join(bundle,'SKILL.md'),'utf8'),/name: wukong-animation/);
 assert.ok(files.includes('engine/bin/wka.mjs'));assert.ok(files.includes('skills/director/INSTRUCTIONS.md'));
 assert.ok(!files.some(f=>/node_modules|\.git\//.test(f)));
 const manifest=JSON.parse(fs.readFileSync(path.join(bundle,'bundle.json')));
 const zip=fs.readFileSync(path.join(out,`wukong-animation-agent-skills-v${manifest.pluginVersion}.zip`));
 assert.equal(zip.readUInt32LE(0),0x04034b50);
 r=run('tools/build-portable.mjs',['--out',out]);assert.equal(r.status,0,r.stderr);
 assert.deepEqual(fs.readFileSync(path.join(out,`wukong-animation-agent-skills-v${manifest.pluginVersion}.zip`)),zip);
 const moved=path.join(tmp,'移动 副本');fs.renameSync(out,moved);
 r=spawnSync(process.execPath,[path.join(moved,'wukong-animation/engine/bin/wka.mjs'),'list','styles'],{cwd:tmp,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/ink-wash/);
});

test('installer exposes explicit profiles and blocks an unqualified candidate',()=>{
 const r=run('tools/install-agent.mjs',['list','--json']);assert.equal(r.status,0,r.stderr);
 const data=JSON.parse(r.stdout);assert.equal(data.agents.length,27);assert.ok(data.agents.filter(a=>a.qualification==='contract-supported').length>=25);
 const bad=run('tools/install-agent.mjs',['install','--agent','cline','--scope','global','--dry-run','--json']);assert.equal(bad.status,2);
});

test('all enabled portable profiles support isolated lifecycle, shared ownership and protect edits',async t=>{
 const {operate,loadProfiles}=await import('../../tools/install-agent.mjs');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wka lifecycle 中 #% '));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const r=run('tools/build-portable.mjs',['--out',path.join(tmp,'release')]);assert.equal(r.status,0,r.stderr);
 const bundle=path.join(tmp,'release/wukong-animation'),context={home:path.join(tmp,'home')};fs.mkdirSync(context.home);
 const project=path.join(tmp,'作品 项目');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'作品.txt'),'不动');
 for(const agent of loadProfiles().agents.filter(p=>p.channel==='portable'&&p.qualification==='contract-supported'))for(const scope of agent.scopes){
  const variant=Object.keys(agent.variants)[0],opt={agent:agent.familyId,scope,project,bundle,variant};
  const before=walk(tmp);const preview=operate('install',{...opt,dryRun:true},context);assert.ok(preview.target.endsWith('wukong-animation'));assert.deepEqual(walk(tmp),before);
  const installed=operate('install',opt,context);assert.equal(installed.state,'current');
  assert.equal(operate('install',opt,context).changed,false,'重复安装应为零变更');
  assert.equal(operate('status',opt,context).resources,'verified');
  const extra=path.join(installed.target,'客户.txt');fs.writeFileSync(extra,'客户改动');
  assert.equal(operate('status',opt,context).state,'modified');
  assert.throws(()=>operate('uninstall',opt,context),e=>e.code===3);assert.equal(fs.readFileSync(extra,'utf8'),'客户改动');fs.unlinkSync(extra);
  operate('uninstall',opt,context);assert.equal(operate('status',opt,context).state,'missing');
 }
 const a={agent:'codex',scope:'project',project,bundle},b={...a,agent:'pi'};
 operate('install',a,context);operate('install',b,context);operate('uninstall',a,context);assert.equal(operate('status',b,context).state,'current');operate('uninstall',b,context);
 assert.equal(fs.readFileSync(path.join(project,'作品.txt'),'utf8'),'不动');
});

test('upgrade, corrupt package, interrupted transaction, locks and conflicts preserve user data',async t=>{
 const api=await import('../../tools/install-agent.mjs');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wka faults '));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const project=path.join(tmp,'项目');fs.mkdirSync(project);
 const r=run('tools/build-portable.mjs',['--out',path.join(tmp,'release')]);assert.equal(r.status,0,r.stderr);
 const bundle=path.join(tmp,'release/wukong-animation'),opt={agent:'codex',scope:'project',project,bundle};
 const result=api.operate('install',opt),target=result.target,parent=path.dirname(target);
 const receipt=fs.readFileSync(path.join(target,'.wukong-install.json'));
 const file=path.join(bundle,'bundle.json'),m=JSON.parse(fs.readFileSync(file));m.pluginVersion='99.0.0';fs.writeFileSync(file,JSON.stringify(m));
 // 更新包损坏时，先校验拒绝而不动旧副本。
 fs.appendFileSync(path.join(bundle,'SKILL.md'),'corrupt');assert.throws(()=>api.operate('upgrade',opt),e=>e.code===4);
 assert.deepEqual(fs.readFileSync(path.join(target,'.wukong-install.json')),receipt);
 fs.writeFileSync(path.join(bundle,'SKILL.md'),fs.readFileSync(path.join(target,'SKILL.md')));
 // 在正式切换处失败，恢复原包与收据。
 const rename=fs.renameSync;
 fs.renameSync=(a,b)=>{if(a.endsWith('.wukong-animation.stage'))throw new Error('切换失败');return rename(a,b);};
 try{assert.throws(()=>api.operate('upgrade',opt),/切换失败/);}finally{fs.renameSync=rename;}
 assert.deepEqual(fs.readFileSync(path.join(target,'.wukong-install.json')),receipt);
 assert.equal(api.operate('upgrade',opt).version,'99.0.0');
 assert.equal(api.operate('status',opt).version,'99.0.0');
 const lock=path.join(parent,'.wukong-animation.lock');fs.writeFileSync(lock,JSON.stringify({marker:'wukong-animation-install-v1',target,pid:process.pid}));
 assert.throws(()=>api.operate('uninstall',opt),e=>e.code===5);fs.unlinkSync(lock);
 // 模拟进程在旧目录已移至 backup 后退出，下一次恢复旧目录。
 fs.renameSync(target,path.join(parent,'.wukong-animation.backup'));
 fs.writeFileSync(path.join(parent,'.wukong-animation.transaction.json'),JSON.stringify({marker:'wukong-animation-install-v1',target}));
 assert.throws(()=>api.operate('uninstall',opt),e=>e.code===3);
 assert.equal(api.operate('status',opt).state,'current');api.operate('uninstall',opt);
 fs.mkdirSync(target);fs.writeFileSync(path.join(target,'客户.txt'),'保留');
 assert.throws(()=>api.operate('install',opt),e=>e.code===3);assert.equal(fs.readFileSync(path.join(target,'客户.txt'),'utf8'),'保留');
});
