import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const load = async file => fs.existsSync(file) ? import(pathToFileURL(path.resolve(file))) : {};
const bench = await load('tools/bench-performance.mjs');
const fixtures = await load('tests/fixtures/performance.mjs');
const temp = t => {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-bench-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};

test('benchmark rejects incomplete arguments, missing engine/lock and insufficient rounds', () => {
  assert.equal(typeof bench.parseOptions,'function','benchmark must validate its inputs');
  assert.throws(()=>bench.parseOptions([]),/engine/);
  assert.throws(()=>bench.parseOptions(['--engine','missing','--suite','hash','--rounds','5','--out','new']),/engine/);
  assert.throws(()=>bench.parseOptions(['--engine','plugin/engine','--suite','hash','--rounds','4','--out','new']),/rounds/);
  const options=bench.parseOptions(['--engine','plugin/engine','--suite','hash','--rounds','5','--out','new']);
  assert.equal(options.rounds,5);assert.equal(options.engine,path.resolve('plugin/engine'));
  assert.throws(()=>bench.parseOptions(['--engine','plugin/engine','--suite','hash','--out','new','--typo']),/unknown/);
});

test('benchmark owns only a new output directory and never overwrites prior evidence', t => {
  assert.equal(typeof bench.claimOutput,'function','benchmark must protect existing output');
  const out=path.join(temp(t),'results');bench.claimOutput(out);
  fs.writeFileSync(path.join(out,'sentinel'),'keep');assert.throws(()=>bench.claimOutput(out),/exist/);
  assert.equal(fs.readFileSync(path.join(out,'sentinel'),'utf8'),'keep');
});

test('engine manifests are validated before collecting samples, including the dependency-free hash suite',async t=>{
  assert.equal(typeof bench.readEngineManifest,'function','a file name alone does not prove a valid lock');
  const dir=temp(t);fs.mkdirSync(path.join(dir,'core'));
  for(const relative of ['package.json','core/dependency-manifest.mjs','core/evidence.mjs','core/file-hash.mjs']) {
    const source=path.resolve('plugin/engine',relative);if(fs.existsSync(source))fs.copyFileSync(source,path.join(dir,relative));
  }
  fs.writeFileSync(path.join(dir,'package-lock.json'),JSON.stringify({lockfileVersion:99,packages:{}}));
  await assert.rejects(bench.readEngineManifest(dir),/lockfileVersion/);
});

test('summary retains failed and timed out rounds and refuses incomplete success', () => {
  assert.equal(typeof bench.summarize,'function','benchmark must not hide failed rounds');
  const rows=Array.from({length:5},(_,i)=>({round:i+1,ok:true,wallMs:10+i}));
  assert.deepEqual(bench.summarize(rows,5),{ok:true,expected:5,total:5,valid:5,failed:0,medianMs:12,minMs:10,maxMs:14});
  assert.equal(bench.summarize(rows.slice(1),5).ok,false);
  assert.equal(bench.summarize([...rows,{round:6,ok:false,timedOut:true}],5).failed,1);
  assert.equal(bench.summarize([...rows.slice(0,4),rows[0]],5).ok,false);
  assert.equal(bench.summarize(rows.map(row=>({...row,round:row.round+5})),5).ok,false,'all expected round IDs must be present');
});

test('fixtures are deterministic, valid PCM and reset cold/warm/single-shot independently', t => {
  assert.equal(typeof fixtures.writeSynthetic,'function','benchmark needs deterministic real fixtures');
  const root=temp(t),a=path.join(root,'a'),b=path.join(root,'b');
  const home=path.join(root,'home');
  fixtures.writeSynthetic(a,{pipeline:'browser',home,count:3,audioBytes:48000*4*7});
  fixtures.writeSynthetic(b,{pipeline:'browser',home,count:3,audioBytes:48000*4*7});
  assert.deepEqual(fs.readFileSync(path.join(a,'film.json')),fs.readFileSync(path.join(b,'film.json')));
  const pcm=fs.readFileSync(path.join(a,'audio/track.wav'));
  assert.equal(pcm.toString('ascii',0,4),'RIFF');assert.equal(pcm.toString('ascii',8,12),'WAVE');
  assert.equal(pcm.readUInt32LE(24),48000);assert.equal(pcm.readUInt16LE(22),2);
  assert.equal(pcm.readUInt32LE(40),pcm.length-44);
  const snapshot=path.join(root,'snapshot');fs.cpSync(a,snapshot,{recursive:true});
  fs.writeFileSync(path.join(a,'shots/s001.js'),'changed');
  fixtures.restoreFixture(snapshot,a,'unchanged');assert.deepEqual(fs.readFileSync(path.join(a,'shots/s001.js')),fs.readFileSync(path.join(b,'shots/s001.js')));
  fixtures.restoreFixture(snapshot,a,'single');assert.match(fs.readFileSync(path.join(a,'shots/s001.js'),'utf8'),/benchmark single shot/);
  fixtures.restoreFixture(snapshot,a,'unchanged');assert.deepEqual(fs.readFileSync(path.join(a,'shots/s001.js')),fs.readFileSync(path.join(b,'shots/s001.js')));
  assert.throws(()=>fixtures.restoreFixture(a,a,'unchanged'),/distinct/);
});

test('managed command records failure/arguments and times out only its own process', async t => {
  assert.equal(typeof bench.runCommand,'function','benchmark must bound child lifetimes');
  const root=temp(t);
  const failed=await bench.runCommand(process.execPath,['-e','process.exit(7)'],{log:path.join(root,'failed'),timeoutMs:5000});
  assert.equal(failed.code,7);assert.equal(failed.ok,false);assert.deepEqual(failed.args,['-e','process.exit(7)']);
  const timed=await bench.runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{log:path.join(root,'timed'),timeoutMs:150});
  assert.equal(timed.timedOut,true);assert.equal(timed.ok,false);assert.ok(timed.wallMs<5000);
});

test('planned matrix includes missing scenarios and rejects silently misspelled filters', () => {
  assert.equal(bench.plannedScenarios({suite:'hash'}).length,9);
  assert.equal(bench.plannedScenarios({suite:'workflow'}).length,48);
  assert.deepEqual(bench.plannedScenarios({suite:'workflow',cases:['browser-example']}),['preview','render'].flatMap(command=>['cold','unchanged','single'].map(mode=>`browser-example-${command}-${mode}`)));
  assert.throws(()=>bench.plannedScenarios({suite:'workflow',cases:['typo']}),/unknown/);
});

test('attribution counts whole/chunked reads once, separately from plain timing', async t => {
  const root=temp(t),file=path.join(root,'binary'),metricFile=path.join(root,'metrics.json'),empty=path.join(root,'written-only');
  fs.writeFileSync(file,Buffer.alloc(17,3));
  const script=`const fs=require('node:fs');const file=${JSON.stringify(file)};fs.readFileSync(file);const fd=fs.openSync(file,'r'),b=Buffer.alloc(6);while(fs.readSync(fd,b,0,6,null)){}fs.closeSync(fd);const written=fs.openSync(${JSON.stringify(empty)},'w');fs.closeSync(written);fs.statSync(file);fs.readdirSync(${JSON.stringify(root)});`;
  const run=await bench.runCommand(process.execPath,['--import',path.resolve('tools/bench-metrics.mjs'),'-e',script],{log:path.join(root,'probe'),env:{...process.env,WKA_BENCH_PROBE:'1',WKA_BENCH_METRICS:metricFile}});
  assert.equal(run.ok,true);
  assert.deepEqual(JSON.parse(fs.readFileSync(metricFile)).files[file],{bytes:34,maxReadRequest:17,completeReads:2});
  assert.equal(JSON.parse(fs.readFileSync(metricFile)).files[empty],undefined,'opening an empty output without reading it is not a complete read');
  const calls=JSON.parse(fs.readFileSync(metricFile)).fsCalls;
  assert.equal(calls.readFileSync,1);assert.equal(calls.readSync,4);assert.equal(calls.openSync,2);assert.equal(calls.closeSync,2);
  assert.equal(calls.statSync,1);assert.equal(calls.readdirSync,1);
  const plain=await bench.runCommand(process.execPath,['--import',path.resolve('tools/bench-metrics.mjs'),'-e',script],{log:path.join(root,'plain'),env:{...process.env,WKA_BENCH_PROBE:'0',WKA_BENCH_METRICS:metricFile}});
  assert.equal(plain.ok,true);assert.deepEqual(JSON.parse(fs.readFileSync(metricFile)).files,{});
});

test('hash samples must preserve identical digests before they can be compared',()=>{
  assert.equal(typeof bench.verifyDigest,'function','benchmark must reject changed hashing semantics');
  assert.doesNotThrow(()=>bench.verifyDigest({result:{sha256:'abc'}},{sha256:'abc'}));
  assert.throws(()=>bench.verifyDigest({result:{sha256:'def'}},{sha256:'abc'}),/digest/);
  assert.throws(()=>bench.verifyDigest({},undefined),/digest/,'missing results cannot establish the reference digest');
});

test('read-only boundary snapshots include empty directories without treating directory timestamps as content',t=>{
  assert.equal(typeof bench.treeIdentity,'function','read-only checks must cover directory creation too');
  const root=temp(t),before=bench.treeIdentity(root),dir=path.join(root,'empty');
  fs.mkdirSync(dir);const added=bench.treeIdentity(root);assert.notDeepEqual(added,before);
  fs.utimesSync(dir,1234567890,1234567890);assert.deepEqual(bench.treeIdentity(root),added,'permitted report writes can change parent timestamps');
  fs.rmdirSync(dir);assert.deepEqual(bench.treeIdentity(root),before);
});

test('timeout also terminates detached owned descendants while leaving unrelated processes alive', {skip:process.platform==='win32'}, async t => {
  const root=temp(t),pidFile=path.join(root,'descendant.pid');
  const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});t.after(()=>unrelated.kill());
  let descendant;t.after(()=>{if(descendant)try{process.kill(descendant,'SIGKILL');}catch{}});
  const script=`const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`;
  const result=await bench.runCommand(process.execPath,['-e',script],{log:path.join(root,'owned'),timeoutMs:1500});
  descendant=Number(fs.readFileSync(pidFile,'utf8'));
  assert.equal(result.timedOut,true);assert.doesNotThrow(()=>process.kill(unrelated.pid,0));
  const pid=descendant;
  // A terminated grandchild may briefly remain a zombie until its new parent reaps it.
  for(let i=0;i<30;i++){
    try{process.kill(pid,0);}catch{return;}
    const status=spawnSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'});
    if(status.status===0&&status.stdout.trim().startsWith('Z'))return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.fail('owned descendant remained alive after timeout');
});
