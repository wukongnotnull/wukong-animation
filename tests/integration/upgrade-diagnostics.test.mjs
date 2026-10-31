import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('upgrade JSON works outside the repository without executable tools or writes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-upgrade-'));const cli=fileURLToPath(new URL('../../plugin/engine/bin/wka.mjs',import.meta.url));
 try{const r=spawnSync(process.execPath,[cli,'check','--upgrade','--json'],{cwd:dir,env:{...process.env,PATH:'',WUKONG_ANIMATION_HOME:dir},encoding:'utf8'});assert.ok([0,1].includes(r.status),r.stderr);assert.equal(r.stderr,'');const out=JSON.parse(r.stdout);assert.equal(out.schemaVersion,1);assert.equal(out.plugin.version,'0.19.5');assert.equal(out.engine.version,'0.2.0');assert.equal(out.exitCode,r.status);assert.equal(out.installation.hostLoaded,null);assert.ok(out.guidance.length);assert.deepEqual(fs.readdirSync(dir),[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
