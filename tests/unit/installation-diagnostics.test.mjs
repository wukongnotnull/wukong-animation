import {fileURLToPath} from 'node:url';import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('installation diagnostics reads identities without changing files',async()=>{
 const mod=await import('../../plugin/engine/core/installation-diagnostics.mjs').catch(()=>null);assert.ok(mod,'missing read-only installation diagnostics');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-diag-'));
 try{fs.writeFileSync(path.join(dir,'plugin.json'),JSON.stringify({name:'wukong-animation',version:'0.19.5'}));fs.mkdirSync(path.join(dir,'engine'));fs.writeFileSync(path.join(dir,'engine/package.json'),JSON.stringify({version:'0.2.0'}));
 const r=mod.installationDiagnostics({pluginRoot:dir,dependency:()=>({root:'/verified/deps',source:'managed',identity:'abc'})});assert.equal(r.plugin.version,'0.19.5');assert.equal(r.engine.version,'0.2.0');assert.equal(r.installation.kind,'unknown');assert.equal(r.exitCode,0);assert.equal(fs.readdirSync(dir).length,2);
 fs.writeFileSync(path.join(dir,'plugin.json'),'{');const bad=mod.installationDiagnostics({pluginRoot:dir,dependency:()=>{throw Error('missing')}});assert.equal(bad.exitCode,1);assert.ok(bad.warnings.length);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('stale unrelated marketplaces are warnings without disclosing credentials',async()=>{
 const {installationDiagnostics}=await import('../../plugin/engine/core/installation-diagnostics.mjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-host-'));
 try{const config=path.join(dir,'config.toml');fs.writeFileSync(config,'api_key="must-not-appear"\n[marketplaces.old]\nsource_type="local"\nsource="/does-not-exist-wka"\n');
 const r=installationDiagnostics({pluginRoot:fileURLToPath(new URL('../../plugin',import.meta.url)),configFile:config,dependency:()=>({root:'/deps'})});assert.ok(r.warnings.some(w=>w.includes('old')&&w.includes('/does-not-exist-wka')));assert.ok(!JSON.stringify(r).includes('must-not-appear'));assert.equal(r.exitCode,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('native conflicts and tampered portable resources are rejected',async()=>{
 const {installationDiagnostics}=await import('../../plugin/engine/core/installation-diagnostics.mjs');const {createHash}=await import('node:crypto');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-id-'));
 const json=(p,value)=>fs.writeFileSync(path.join(dir,p),JSON.stringify(value));const inspect=()=>installationDiagnostics({pluginRoot:dir,configFile:path.join(dir,'none'),dependency:()=>({root:'/deps'})});
 try{
 fs.mkdirSync(path.join(dir,'engine'));json('engine/package.json',{version:'0.2.0'});json('plugin.json',{name:'wukong-animation',version:'0.19.5'});fs.mkdirSync(path.join(dir,'.codex-plugin'));json('.codex-plugin/plugin.json',{name:'wukong-animation',version:'0.19.5'});
 assert.equal(inspect().installation.kind,'native');assert.equal(inspect().exitCode,0);json('.codex-plugin/plugin.json',{name:'wukong-animation',version:'0.0.0'});assert.equal(inspect().exitCode,1);
 fs.unlinkSync(path.join(dir,'plugin.json'));const file=fs.readFileSync(path.join(dir,'engine/package.json'));json('bundle.json',{schemaVersion:1,pluginVersion:'0.19.5',engineVersion:'0.2.0',sourceCommit:'fixture',files:[{path:'engine/package.json',sha256:createHash('sha256').update(file).digest('hex')}]});
 assert.equal(inspect().installation.kind,'portable');assert.equal(inspect().exitCode,0);json('engine/package.json',{version:'0.2.0',changed:true});assert.equal(inspect().exitCode,1);
 json('bundle.json',{schemaVersion:1,pluginVersion:'0.19.5',engineVersion:'0.2.0',files:[{path:'../outside',sha256:'invalid'}]});assert.equal(inspect().exitCode,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('invalid version values are reported as null rather than echoed',async()=>{
 const {installationDiagnostics}=await import('../../plugin/engine/core/installation-diagnostics.mjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-version-'));
 try{fs.mkdirSync(path.join(dir,'engine'));fs.writeFileSync(path.join(dir,'plugin.json'),JSON.stringify({version:{secret:'hidden'}}));fs.writeFileSync(path.join(dir,'engine/package.json'),JSON.stringify({version:42}));const r=installationDiagnostics({pluginRoot:dir,configFile:path.join(dir,'none'),dependency:()=>({root:'/deps'})});assert.equal(r.plugin.version,null);assert.equal(r.engine.version,null);assert.equal(r.exitCode,1);assert.ok(!JSON.stringify(r).includes('hidden'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
